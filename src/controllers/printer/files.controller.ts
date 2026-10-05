import { Request, Response, NextFunction } from "express";
import { pickOrderSheet } from "../../utils/orderSheets.js";
import { apiFileUrl } from "../../utils/publicApiBase.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";
import { Order } from "../../models/order.model.js";
import { Asset } from "../../models/asset.model.js";
import { Design } from "../../models/design.model.js";
import archiver from "archiver";
import mongoose from "mongoose";
import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import { Readable } from "node:stream";
import { GangsheetExport } from "../../models/gangsheetExport.model.js";
import { GangsheetExportAudit } from "../../models/gangsheetExportAudit.model.js";
import {
  exportGangsheetPng24,
  orderSheetPrintFileIn,
  computeItemVerticalSpansIn,
  computeGangsheetCuts,
  orderSheetWidthIn,
  GANGSHEET_PRINT_DPI,
} from "../../services/gangsheetExport.service.js";
import { uploadPngToDrive } from "../../services/googleDrive.service.js";
import sharp from "sharp";
import { CustomError, isObjectIdString, splitAssetRefs } from "./shared.js";

// In-memory export job queue — lets the HTTP response return immediately while
// the (potentially slow) PNG render runs in the background.
type ExportJobStatus = "queued" | "processing" | "done" | "failed";

interface InMemoryExportJob {
  status: ExportJobStatus;
  progress?: number;
  message?: string;
  result?: {
    exportId: string;
    dpi: number;
    sheet: { widthIn: number; heightIn: number };
    validation: { ok: boolean; errors: string[]; meta?: any };
    drive: { uploaded: boolean; fileId?: string; webViewLink?: string; error?: string } | null;
  };
  error?: string;
  createdAt: number;
}

const exportJobStore = new Map<string, InMemoryExportJob>();

/**
 * Target printed length per exported part.
 *
 * A target rather than a hard boundary: a graphic straddling the line pushes
 * the cut down to its far edge (see `computeGangsheetCuts`), so a part may run
 * longer than this, but never splits a piece of artwork.
 */
const GANGSHEET_TARGET_LENGTH_IN = 100;
// Purge jobs older than 1 hour to prevent unbounded memory growth.
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [k, v] of exportJobStore) {
    if (v.createdAt < cutoff) exportJobStore.delete(k);
  }
}, 300_000).unref();

const resolveLocalUploadPath = (url: string) => {
  const marker = "/uploads/";
  const idx = String(url || "").lastIndexOf(marker);
  if (idx === -1) return null;
  const filename = String(url).substring(idx + marker.length);
  const safeFilename = path.basename(filename);
  return path.join(process.cwd(), "uploads", safeFilename);
};

const computeThumbUrl = (assetUrl: string | null | undefined): string | null => {
  if (!assetUrl) return null;
  const lastSlash = assetUrl.lastIndexOf("/");
  const lastDot = assetUrl.lastIndexOf(".");
  if (lastDot <= lastSlash) return null;
  return assetUrl.substring(0, lastDot) + "-thumb200.webp";
};

export const getJobAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;
    const pageSize = Math.max(1, Math.min(500, parseInt(String(req.query.limit || "200"), 10) || 200));
    const pageNum = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId })
      .select("items")
      .lean();

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const assetIdSet = new Set<string>();

    for (const item of (job as any).items || []) {
      if (item.type === "gangsheet" || item.artboardItems) {
        if (Array.isArray(item.artboardItems) && item.artboardItems.length > 0) {
          for (const ai of item.artboardItems) {
            if (ai.assetId) assetIdSet.add(String(ai.assetId));
          }
        } else if (item.designId && isObjectIdString(String(item.designId))) {
          const design = await Design.findById(item.designId).select("artboardData").lean();
          if (design?.artboardData?.items) {
            for (const di of (design as any).artboardData.items) {
              if (di.assetId) assetIdSet.add(String(di.assetId));
            }
          }
        }
      }
    }

    // Paginate the ID set — no DB skip/limit needed, just slice the array.
    const allIds = Array.from(assetIdSet);
    const total = allIds.length;
    const offset = (pageNum - 1) * pageSize;
    const pageIds = allIds.slice(offset, offset + pageSize);

    const { ids, urls } = splitAssetRefs(new Set(pageIds));
    const assets = pageIds.length
      ? await Asset.find({
          $or: [
            ...(ids.length ? [{ _id: { $in: ids } }] : []),
            ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : []),
          ],
        }).select("url trimmedUrl originalFilename widthPx heightPx dpi sizeBytes")
      : [];

    const uniqueAssetsMap = new Map<string, any>();
    for (const asset of assets) {
      const url = asset.url;
      if (url && !uniqueAssetsMap.has(url)) {
        uniqueAssetsMap.set(url, {
          id: asset.id,
          filename: asset.originalFilename,
          widthPx: asset.widthPx,
          heightPx: asset.heightPx,
          dpi: asset.dpi,
          downloadUrl: asset.url,
          thumbnailUrl: computeThumbUrl(asset.trimmedUrl || asset.url),
          sizeBytes: asset.sizeBytes || 0,
        });
      }
    }

    const formattedAssets = Array.from(uniqueAssetsMap.values());
    const totalBytes = formattedAssets.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);

    res.json({
      assets: formattedAssets,
      total,
      counts: { images: total, totalBytes },
    });
  } catch (error) {
    next(error);
  }
};

export const createJobAssetBundle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { include } = req.body;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const allAssetIds = new Set<string>();

    for (const item of job.items) {
      // Only items in the gangsheet should be shown
      if (item.type === "gangsheet" || item.artboardItems) {
        if (Array.isArray(item.artboardItems) && item.artboardItems.length > 0) {
          item.artboardItems.forEach((ai: any) => {
            if (ai.assetId) allAssetIds.add(String(ai.assetId));
          });
        } else if (item.designId && isObjectIdString(String(item.designId))) {
          // Fallback to design if artboardItems not snapshotted in order
          const design = await Design.findById(item.designId).select("artboardData").lean();
          if (design?.artboardData?.items) {
            design.artboardData.items.forEach((di: any) => {
              if (di.assetId) allAssetIds.add(String(di.assetId));
            });
          }
        }
      }
    }

    let targetAssetIds = Array.from(allAssetIds);

    if (Array.isArray(include)) {
      targetAssetIds = targetAssetIds.filter(id => include.includes(id));
      if (targetAssetIds.length === 0) {
        const error = new Error("None of the specified assets were found in this job") as CustomError;
        error.statusCode = 400;
        throw error;
      }
    } else if (include !== "ALL") {
      const error = new Error("Invalid 'include' value. Use 'ALL' or an array of asset IDs.") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const bundleBase = apiFileUrl(req, "");
    res.status(201).json({
      bundleDownloadUrl: `${bundleBase}/api/printer/jobs/${encodeURIComponent(String(job.id))}/assets/bundle/download${
        include === "ALL"
          ? `?include=ALL`
          : Array.isArray(include)
            ? `?include=${encodeURIComponent(include.map((v: any) => String(v)).join(","))}`
            : ""
      }`
    });
  } catch (error) {
    next(error);
  }
};

export const downloadJobAssetBundle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const includeParam = Array.isArray(req.query.include) ? String(req.query.include[0] || "") : String(req.query.include || "ALL");
    const includeAll = !includeParam || includeParam === "ALL";
    const requestedIds = includeAll
      ? null
      : includeParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    const allAssetIds = new Set<string>();

    for (const item of job.items) {
      // Only items in the gangsheet should be shown
      if (item.type === "gangsheet" || item.artboardItems) {
        if (Array.isArray(item.artboardItems) && item.artboardItems.length > 0) {
          item.artboardItems.forEach((ai: any) => {
            if (ai.assetId) allAssetIds.add(String(ai.assetId));
          });
        } else if (item.designId && isObjectIdString(String(item.designId))) {
          // Fallback to design if artboardItems not snapshotted in order
          const design = await Design.findById(item.designId).select("artboardData").lean();
          if (design?.artboardData?.items) {
            design.artboardData.items.forEach((di: any) => {
              if (di.assetId) allAssetIds.add(String(di.assetId));
            });
          }
        }
      }
    }

    // Include additional logic to normalize asset IDs for filtering
    const { ids: jobAssetIds, urls: jobAssetUrls } = splitAssetRefs(allAssetIds);
    const jobAssetIdStrings = new Set([
      ...jobAssetIds.map(id => id.toString()),
      ...jobAssetUrls
    ]);

    let targetAssetIds = Array.from(allAssetIds);
    if (requestedIds) {
      // Ensure we compare requested IDs against the normalized job asset IDs
      targetAssetIds = requestedIds.filter((id) => jobAssetIdStrings.has(id));
      if (targetAssetIds.length === 0) {
        const error = new Error("None of the specified assets were found in this job") as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    const { ids, urls } = splitAssetRefs(new Set(targetAssetIds));
    const assets =
      ids.length || urls.length
        ? await Asset.find({
            $or: [
              ...(ids.length ? [{ _id: { $in: ids } }] : []),
              ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : [])
            ]
          }).lean()
        : [];

    if (assets.length === 0) {
      const error = new Error("No assets available for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    // Named with the order number the partner sees (DTF-0283), not an id fragment.
    const zipName = `original_assets_${String((job as any).displayId || String(job.id).slice(-6).toUpperCase())}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 0 } });
    archive.on("error", (err: any) => {
      next(err);
    });
    archive.pipe(res);

    const addedFiles = new Set<string>();
    const usedNames = new Set<string>();
    const skippedFiles: string[] = [];
    let addedCount = 0;

    for (const a of assets as any[]) {
      // Prioritize the original URL for "Download Original" functionality
      const url = String(a?.url || a?.trimmedUrl || "");
      if (!url) continue;

      // Prevent duplicate files in the same bundle - "ensure users receive a single, clean copy"
      if (addedFiles.has(url)) continue;
      addedFiles.add(url);

      const preferredName = String(a?.originalFilename || "").trim();
      const fallbackName = path.basename(url.split("?")[0] || "") || `asset_${String(a?._id || "")}.bin`;
      let entryName = preferredName || fallbackName;

      // Handle name collisions in the zip
      if (usedNames.has(entryName)) {
        const ext = path.extname(entryName);
        const base = path.basename(entryName, ext);
        let counter = 1;
        while (usedNames.has(`${base}_${counter}${ext}`)) {
          counter++;
        }
        entryName = `${base}_${counter}${ext}`;
      }
      usedNames.add(entryName);

      const localPath = resolveLocalUploadPath(url);

      try {
        // Direct reference to source file - "verify download mechanism correctly references gansheet source"
        if (localPath && fs.existsSync(localPath)) {
          const stats = fs.statSync(localPath);
          if (stats.size > 0) {
            archive.file(localPath, { name: entryName });
            addedCount++;
            continue;
          } else {
            console.warn(`Asset file is empty: ${localPath}`);
            skippedFiles.push(`${entryName} (Empty file)`);
            continue;
          }
        }

        // Fallback to remote fetch if not local, still streaming - "eliminate redundant file generation"
        if (/^https?:\/\//i.test(url)) {
          const r = await fetchWithTimeout(url, {}, 90_000, "Loading the artwork");
          if (r.ok) {
            const contentLength = r.headers.get("content-length");
            if (contentLength === "0") {
              skippedFiles.push(`${entryName} (Remote file is empty)`);
              continue;
            }
            const body = r.body ? Readable.fromWeb(r.body as any) : null;
            if (body) {
              archive.append(body, { name: entryName });
              addedCount++;
            } else {
              skippedFiles.push(`${entryName} (Failed to read remote body)`);
            }
          } else {
            skippedFiles.push(`${entryName} (Remote fetch failed: ${r.status})`);
          }
        } else {
          skippedFiles.push(`${entryName} (Invalid source URL)`);
        }
      } catch (err) {
        console.error(`Error adding asset ${a._id} to bundle:`, err);
        skippedFiles.push(`${entryName} (Internal error)`);
      }
    }

    if (skippedFiles.length > 0) {
      const errorLog = `The following files could not be included in this bundle:\n\n${skippedFiles.join("\n")}`;
      archive.append(errorLog, { name: "DOWNLOAD_ERRORS.txt" });
    }

    await archive.finalize();
  } catch (error) {
    next(error);
  }
};

export const exportJobGangsheet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { format, toDrive } = req.body || {};
    const printerId = req.user?.id;

    if (!format || String(format).toUpperCase() !== "PNG") {
      const error = new Error("Invalid format. Must be PNG") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    // Which sheet: an order can hold several, and each is printed separately.
    const { sheet: gangsheetItem, index: sheetIndex, count: sheetCount } = pickOrderSheet(job.items, req.body?.sheet ?? req.query?.sheet);
    // "…_sheet2of2.png" when the order has more than one, so the files can be told apart.
    const sheetSuffix = sheetCount > 1 ? `_sheet${sheetIndex + 1}of${sheetCount}` : "";
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    const exportJobId = crypto.randomUUID();
    exportJobStore.set(exportJobId, { status: "queued", createdAt: Date.now() });

    // Fire-and-forget: render happens in background so the HTTP response returns immediately.
    (async () => {
      exportJobStore.set(exportJobId, { ...exportJobStore.get(exportJobId)!, status: "processing" });
      try {
        // Preserve croppedUrl — it holds the trimmedUrl (full-res, server-processed) or
        // a data URL from canvas fallback / AI background removal. Stripping it causes the
        // export to fall back to the ORIGINAL (untrimmed) stored URL and resize it into
        // the trimmed bounding box via fit:"fill", which distorts the image.
        const fullResItems = artboardItems.map((it: any) => ({
          assetId: String(it.assetId || ""),
          croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
          // Pixel dimensions of the croppedUrl source — provided by the client for
          // canvas-processed items (canvas crop, BG removal) so the DPI calculation
          // uses the ACTUAL exported pixel count, not the DB's pre-crop original.
          croppedWidthPx: typeof it.croppedWidthPx === "number" && it.croppedWidthPx > 0 ? it.croppedWidthPx : undefined,
          widthIn: Number(it.widthIn),
          heightIn: Number(it.heightIn),
          posX: Number(it.posX),
          posY: Number(it.posY),
          rotation: typeof it.rotation === "number" ? it.rotation : 0,
          flipped: Boolean(it.flipped),
          copies: typeof it.copies === "number" ? it.copies : 1,
          nestRotation: it.nestRotation,
          flowCols: it.flowCols,
        }));

        // Determine export DPI from the native resolution of the ACTUAL source images.
        //
        // Priority order for pixel-count source:
        //   1. croppedWidthPx (client-supplied for canvas-processed items):
        //      The canvas output pixel count — always accurate regardless of DB state.
        //      Canvas crop shrinks the image (cropWidth < widthPx), so using widthPx
        //      would produce exportDpi = widthPx/widthIn >> actual, causing upscaling.
        //   2. trimmedWidthPx from DB (for server-trimmed items):
        //      The server-trimmed image pixel count. widthIn = trimmedWidthIn so
        //      effectiveDpi = trimmedWidthPx/widthIn is the exact native DPI.
        //   3. widthPx from DB (fallback — original upload, pre-trim):
        //      Only used when no trim was performed and no canvas processing occurred.
        //
        // We take the MIN across all items so no source is ever upscaled:
        //   effectiveDpi = srcPx / it.widthIn
        //   exportDpi    = min(effectiveDpis), clamped [72, 600]
        const uniqueAssetIds = [
          ...new Set(
            fullResItems
              .filter((it) => !it.croppedWidthPx && mongoose.Types.ObjectId.isValid(it.assetId))
              .map((it) => it.assetId)
          ),
        ];
        const exportDpi = GANGSHEET_PRINT_DPI;
        {
          const effectiveDpis: number[] = [];

          // Items with client-supplied croppedWidthPx: use it directly — most accurate.
          for (const it of fullResItems) {
            if (!(it.widthIn > 0)) continue;
            if (typeof it.croppedWidthPx === "number" && it.croppedWidthPx > 0) {
              effectiveDpis.push(Math.round(it.croppedWidthPx / it.widthIn));
            }
          }

          // Items without croppedWidthPx: look up DB dimensions.
          if (uniqueAssetIds.length > 0) {
            const sourceAssets = await Asset.find({
              _id: { $in: uniqueAssetIds.map((id) => new mongoose.Types.ObjectId(id)) },
            })
              .select("dpi widthPx heightPx trimmedWidthPx trimmedHeightPx")
              .lean();
            const assetMap = new Map(
              (sourceAssets as any[]).map((a) => [String(a._id), a])
            );
            for (const it of fullResItems) {
              if (!(it.widthIn > 0) || it.croppedWidthPx) continue;
              const asset = assetMap.get(it.assetId) as any;
              if (!asset) continue;
              const srcPx =
                (typeof asset.trimmedWidthPx === "number" && asset.trimmedWidthPx > 0)
                  ? asset.trimmedWidthPx
                  : (typeof asset.widthPx === "number" && asset.widthPx > 0)
                  ? asset.widthPx
                  : null;
              if (srcPx !== null) {
                effectiveDpis.push(Math.round(srcPx / it.widthIn));
              } else if (typeof asset.dpi === "number" && asset.dpi > 0) {
                effectiveDpis.push(asset.dpi);
              }
            }
          }

          if (effectiveDpis.length > 0) {
            const lowest = Math.min(...effectiveDpis);
            if (lowest < GANGSHEET_PRINT_DPI) {
              console.warn(
                `[gangsheet] job=${job.id} lowest source DPI ${lowest} is below the ` +
                `${GANGSHEET_PRINT_DPI} DPI print target; those items are upscaled into their slots.`,
              );
            }
          }
        }

        const printFile = orderSheetPrintFileIn(gangsheetItem);
        const rendered = await exportGangsheetPng24({
          jobId: job.id,
          printerId: String(printerId),
          // The roll this order was built on, so every posX lands where the
          // artboard put it — see `orderSheetWidthIn`.
          sheetWidthIn: printFile.widthIn,
          sheetHeightIn: printFile.heightIn,
          artboardItems: fullResItems,
          dpi: exportDpi,
          // Full width — preserves the artboard layout 1:1 so item positions
          // match exactly what the customer approved.
          cropToContent: false,
          itemSpacingIn: typeof gangsheetItem.itemSpacingIn === "number" ? gangsheetItem.itemSpacingIn : undefined,
          sheetMarginIn: typeof gangsheetItem.sheetMarginIn === "number" ? gangsheetItem.sheetMarginIn : undefined,
        });

        // Structural errors (format mismatch, wrong dimensions, missing alpha) indicate a
        // genuinely broken file — fail hard. Resolution warnings are non-fatal.
        const structuralErrors = rendered.validation.errors.filter(
          (e) => !e.startsWith("asset_") && !e.includes("dpi") && !e.includes("colorspace"),
        );
        if (structuralErrors.length > 0) {
          exportJobStore.set(exportJobId, {
            ...exportJobStore.get(exportJobId)!,
            status: "failed",
            error: `Export failed: ${structuralErrors.join(", ")}`,
          });
          return;
        }

        const exportDoc = await GangsheetExport.create({
          jobId: new mongoose.Types.ObjectId(job.id),
          printerId: new mongoose.Types.ObjectId(String(printerId)),
          format: "png",
          dpi: rendered.dpi,
          sheet: rendered.sheet,
          fileName: sheetSuffix ? rendered.fileName.replace(/(\.[a-z0-9]+)$/i, `${sheetSuffix}$1`) : rendered.fileName,
          filePath: rendered.filePath,
          byteSize: rendered.byteSize,
          validation: rendered.validation,
          drive: { status: "skipped" },
        });

        await GangsheetExportAudit.create({
          exportId: exportDoc._id,
          jobId: exportDoc.jobId,
          printerId: exportDoc.printerId,
          action: "export_created",
          meta: { format: "png", dpi: rendered.dpi },
        });

        let driveResult: any = null;
        if (Boolean(toDrive)) {
          const uploaded = await uploadPngToDrive({ localFilePath: rendered.filePath, fileName: rendered.fileName });
          if (uploaded.uploaded) {
            await GangsheetExport.updateOne(
              { _id: exportDoc._id },
              { $set: { drive: { status: "uploaded", fileId: uploaded.fileId, webViewLink: uploaded.webViewLink, uploadedAt: new Date() } } },
            );
            await GangsheetExportAudit.create({
              exportId: exportDoc._id, jobId: exportDoc.jobId, printerId: exportDoc.printerId,
              action: "drive_uploaded", meta: { fileId: uploaded.fileId, webViewLink: uploaded.webViewLink },
            });
          } else {
            await GangsheetExport.updateOne(
              { _id: exportDoc._id },
              { $set: { drive: { status: "failed", error: uploaded.error || "drive_failed" } } },
            );
            await GangsheetExportAudit.create({
              exportId: exportDoc._id, jobId: exportDoc.jobId, printerId: exportDoc.printerId,
              action: "drive_failed", meta: { error: uploaded.error || "drive_failed" },
            });
          }
          driveResult = uploaded;
        }

        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "done",
          result: {
            exportId: String(exportDoc._id),
            dpi: rendered.dpi,
            sheet: rendered.sheet,
            validation: rendered.validation,
            drive: driveResult
              ? { uploaded: Boolean(driveResult.uploaded), fileId: driveResult.fileId, webViewLink: driveResult.webViewLink, error: driveResult.error }
              : null,
          },
        });
      } catch (err: any) {
        console.error("[export-job] failed", {
          exportJobId,
          jobId: job.id,
          printerId: String(printerId),
          message: err?.message,
          stack: err?.stack,
        });
        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "failed",
          error: err?.message || "Export failed",
        });
      }
    })().catch((err) => {
      console.error("[export-job] outer error", { exportJobId, err });
    });

    res.status(202).json({ exportJobId, status: "queued" });
  } catch (error) {
    next(error);
  }
};

export const getExportJobStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { exportJobId } = req.params;
    const job = exportJobStore.get(String(exportJobId || ""));
    if (!job) {
      const error = new Error("Export job not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }
    res.json(job);
  } catch (error) {
    next(error);
  }
};

export const getJobGangsheetPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const requestedResolution = Math.max(72, Math.min(100, parseInt(req.query.resolution as string) || 72));
    const printerId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(String(jobId))) {
      const error = new Error("Invalid job id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Fetch all artboard items but project only the 8 rendering fields — never loads
    // full artboard documents. 10k items × ~100 bytes = ~1 MB, vs MB-per-item without projection.
    const [jobRaw] = await (Order as any).aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(String(jobId)), assignedPrinter: new mongoose.Types.ObjectId(String(printerId)) } },
      { $project: {
        items: {
          $map: {
            input: { $ifNull: ["$items", []] },
            as: "item",
            in: {
              type: "$$item.type",
              widthIn: "$$item.widthIn",
              heightIn: "$$item.heightIn",
              sheetWidthIn: "$$item.sheetWidthIn",
              rollWidthIn: "$$item.rollWidthIn",
              sheetHeightIn: "$$item.sheetHeightIn",
              itemSpacingIn: "$$item.itemSpacingIn",
              sheetMarginIn: "$$item.sheetMarginIn",
              artboardItems: {
                $map: {
                  input: { $ifNull: ["$$item.artboardItems", []] },
                  as: "ai",
                  in: {
                    assetId: "$$ai.assetId",
                    croppedUrl: "$$ai.croppedUrl",
                    widthIn: "$$ai.widthIn",
                    heightIn: "$$ai.heightIn",
                    posX: "$$ai.posX",
                    posY: "$$ai.posY",
                    rotation: "$$ai.rotation",
                    flipped: "$$ai.flipped",
                    copies: "$$ai.copies",
                    nestRotation: "$$ai.nestRotation",
                    flowCols: "$$ai.flowCols",
                  },
                },
              },
            },
          },
        },
      }},
    ]);

    if (!jobRaw) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { sheet: gangsheetItem } = pickOrderSheet(jobRaw.items, req.body?.sheet ?? req.query?.sheet);
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    /**
     * The roll width this order was built on — see `orderSheetWidthIn`.
     *
     * Never the artwork's bounding width: item `posX` values are absolute
     * against the roll, so a canvas sized to anything else puts every
     * x-coordinate in the wrong place and clips what falls past its edge.
     */
    const sheetWidthIn = orderSheetWidthIn(gangsheetItem);
    const sheetHeightIn = typeof gangsheetItem.sheetHeightIn === "number" && Number.isFinite(gangsheetItem.sheetHeightIn)
      ? gangsheetItem.sheetHeightIn : typeof gangsheetItem.heightIn === "number" && Number.isFinite(gangsheetItem.heightIn)
      ? gangsheetItem.heightIn : 23.5;

    const resolution = requestedResolution;

    // Preserve croppedUrl — it is the trimmedUrl (server-processed, full-res) for server-trimmed
    // assets, or a lossless data URL for canvas-cropped / AI bg-removed items. Stripping it
    // forces the export to use the original (untrimmed) stored URL and resize it into the
    // trimmed bounding box via fit:"fill", which squishes the image and causes visible distortion.
    const fullResItems = artboardItems.map((it: any) => ({
      assetId: it.assetId,
      croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
      widthIn: it.widthIn,
      heightIn: it.heightIn,
      posX: it.posX,
      posY: it.posY,
      rotation: it.rotation,
      flipped: it.flipped,
      copies: it.copies,
      nestRotation: it.nestRotation,
      flowCols: it.flowCols,
    }));

    // WebP has a hard 16383 px per-dimension limit. For very tall sheets (e.g. a
    // 1179" roll) this caps DPI to 13 — unacceptably low. PNG has no dimension
    // limit; it is instead capped by the 2 GB RGBA buffer, giving ~146 DPI for
    // the same sheet. Auto-switch to PNG when WebP would result in < 50 DPI.
    const WEBP_DIM_LIMIT = 16383;
    const MIN_WEBP_DPI = 50;
    const webpMaxDpi = Math.min(
      Math.floor(WEBP_DIM_LIMIT / Math.max(0.01, sheetWidthIn)),
      Math.floor(WEBP_DIM_LIMIT / Math.max(0.01, sheetHeightIn))
    );
    const previewFormat: "webp" | "png" = webpMaxDpi >= MIN_WEBP_DPI ? "webp" : "png";

    const rendered = await exportGangsheetPng24({
      jobId: String(jobId),
      printerId: String(printerId),
      sheetWidthIn,
      sheetHeightIn,
      artboardItems: fullResItems,
      dpi: resolution,
      cropToContent: true,
      format: previewFormat,
      useLossyPreview: true, // Use fast lossy WebP for preview
      itemSpacingIn: typeof gangsheetItem.itemSpacingIn === "number" ? gangsheetItem.itemSpacingIn : undefined,
      sheetMarginIn: typeof gangsheetItem.sheetMarginIn === "number" ? gangsheetItem.sheetMarginIn : undefined,
    });

    // Build a public-facing base URL from the request so the preview URL works
    // regardless of whether APP_URL is set. Heroku terminates TLS and sets
    // x-forwarded-proto, so we use that header instead of req.protocol.
    // The API's own address, not APP_URL (the store's) — see utils/publicApiBase.ts.
    const previewDataUrl = apiFileUrl(req, rendered.relativePath);

    res.json({
      previewDataUrl,
      resolutionDPI: rendered.dpi,
      sheetWidthIn: rendered.sheet.widthIn,
      sheetHeightIn: rendered.sheet.heightIn,
      totalItems: artboardItems.length,
      cacheKey: rendered.cacheKey,
    });
  } catch (error) {
    next(error);
  }
};

export const downloadGangsheetExport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { exportId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(exportId) ? String(exportId[0] || "") : String(exportId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid export id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const exp = await GangsheetExport.findOne({ _id: new mongoose.Types.ObjectId(id), printerId: new mongoose.Types.ObjectId(String(printerId)) }).lean();
    if (!exp) {
      const error = new Error("Export not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!fs.existsSync(String((exp as any).filePath))) {
      const error = new Error("Export file missing") as CustomError;
      error.statusCode = 410;
      throw error;
    }

    await GangsheetExportAudit.create({
      exportId: (exp as any)._id,
      jobId: (exp as any).jobId,
      printerId: (exp as any).printerId,
      action: "downloaded",
      meta: { userAgent: String(req.headers["user-agent"] || ""), ip: String(req.ip || "") }
    });

    const filePath = String((exp as any).filePath);
    const fileName = String((exp as any).fileName);

    // res.download() streams the file with a correct Content-Length, Content-Type
    // (from the extension — .zip → application/zip, .png → image/png), an
    // attachment Content-Disposition, and — critically — Accept-Ranges support so
    // the browser can resume a partial transfer. This replaces the previous
    // manual createReadStream().pipe(res), which buffered the whole file in page
    // memory on the client and corrupted large (hundreds-of-MB) split-gangsheet
    // zips.
    res.setHeader("Cache-Control", "no-store");
    res.download(filePath, fileName, (err) => {
      // A dropped connection mid-stream is expected and not actionable; only
      // surface a real error if we haven't started sending the body yet.
      if (err && !res.headersSent) next(err);
    });
  } catch (error) {
    next(error);
  }
};

export const exportPngForDownload = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    if (!jobId || !mongoose.Types.ObjectId.isValid(String(jobId))) {
      const error = new Error("Invalid job id") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    if (!printerId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const [jobRaw] = await (Order as any).aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(String(jobId)), assignedPrinter: new mongoose.Types.ObjectId(String(printerId)) } },
      { $project: {
        displayId: 1,
        "customer.firstName": 1,
        "customer.lastName": 1,
        items: {
          $map: {
            input: { $ifNull: ["$items", []] },
            as: "item",
            in: {
              type: "$$item.type",
              widthIn: "$$item.widthIn",
              heightIn: "$$item.heightIn",
              sheetWidthIn: "$$item.sheetWidthIn",
              rollWidthIn: "$$item.rollWidthIn",
              sheetHeightIn: "$$item.sheetHeightIn",
              itemSpacingIn: "$$item.itemSpacingIn",
              sheetMarginIn: "$$item.sheetMarginIn",
              artboardItems: {
                $map: {
                  input: { $ifNull: ["$$item.artboardItems", []] },
                  as: "ai",
                  in: {
                    assetId: "$$ai.assetId",
                    croppedUrl: "$$ai.croppedUrl",
                    widthIn: "$$ai.widthIn",
                    heightIn: "$$ai.heightIn",
                    posX: "$$ai.posX",
                    posY: "$$ai.posY",
                    rotation: "$$ai.rotation",
                    flipped: "$$ai.flipped",
                    copies: "$$ai.copies",
                    nestRotation: "$$ai.nestRotation",
                    flowCols: "$$ai.flowCols",
                  },
                },
              },
            },
          },
        },
      }},
    ]);

    if (!jobRaw) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { sheet: gangsheetItem, index: sheetIndex, count: sheetCount } = pickOrderSheet(jobRaw.items, req.body?.sheet ?? req.query?.sheet);
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    const exportJobId = crypto.randomUUID();
    exportJobStore.set(exportJobId, { status: "queued", progress: 0, message: "Queued...", createdAt: Date.now() });

    (async () => {
      const setProgress = (progress: number, message: string) => {
        exportJobStore.set(exportJobId, { ...exportJobStore.get(exportJobId)!, progress, message });
      };

      try {
        exportJobStore.set(exportJobId, { ...exportJobStore.get(exportJobId)!, status: "processing" });
        setProgress(5, "Preparing export...");

        /**
         * The printed sheet is the full roll width this order was built on —
         * see `orderSheetWidthIn`. Never the item's own width, which on older
         * orders produced an export a few inches wide with the artwork packed in.
         */
        const { widthIn: sheetWidthIn, heightIn: sheetHeightIn } = orderSheetPrintFileIn(gangsheetItem);

        const fullResItems = artboardItems.map((it: any) => ({
          assetId: String(it.assetId || ""),
          croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
          widthIn: Number(it.widthIn),
          heightIn: Number(it.heightIn),
          posX: Number(it.posX),
          posY: Number(it.posY),
          rotation: typeof it.rotation === "number" ? it.rotation : 0,
          flipped: Boolean(it.flipped),
          copies: typeof it.copies === "number" ? it.copies : 1,
          nestRotation: it.nestRotation,
          flowCols: it.flowCols,
        }));

        setProgress(10, "Generating PNG...");

        const uniqueAssetIdsForDpi: string[] = Array.from(
          new Set<string>(
            (fullResItems as any[])
              .filter((it: any) => !String(it.croppedUrl || "").startsWith("data:") && isObjectIdString(String(it.assetId || "")))
              .map((it: any) => String(it.assetId))
          )
        );
        const exportDpi = GANGSHEET_PRINT_DPI;
        let lowestSourceDpi: number | null = null;
        if (uniqueAssetIdsForDpi.length > 0) {
          const sourceAssets = await Asset.find({
            _id: { $in: uniqueAssetIdsForDpi.map((id: string) => new mongoose.Types.ObjectId(id)) },
          })
            .select("dpi widthPx trimmedWidthPx")
            .lean();
          const assetMap = new Map((sourceAssets as any[]).map((a) => [String(a._id), a]));
          const effectiveDpis: number[] = [];
          for (const it of fullResItems as any[]) {
            if (!(Number(it.widthIn) > 0) || String(it.croppedUrl || "").startsWith("data:")) continue;
            const asset = assetMap.get(String(it.assetId)) as any;
            if (!asset) continue;
            const srcPx =
              typeof asset.trimmedWidthPx === "number" && asset.trimmedWidthPx > 0
                ? asset.trimmedWidthPx
                : typeof asset.widthPx === "number" && asset.widthPx > 0
                ? asset.widthPx
                : null;
            if (srcPx !== null) {
              effectiveDpis.push(Math.round(srcPx / Number(it.widthIn)));
            } else if (typeof asset.dpi === "number" && asset.dpi > 0) {
              effectiveDpis.push(asset.dpi);
            }
          }
          if (effectiveDpis.length > 0) {
            lowestSourceDpi = Math.min(...effectiveDpis);
            if (lowestSourceDpi < GANGSHEET_PRINT_DPI) {
              console.warn(
                `[gangsheet] job=${jobId} lowest source DPI ${lowestSourceDpi} is below the ` +
                `${GANGSHEET_PRINT_DPI} DPI print target; those items are upscaled into their slots.`,
              );
            }
          }
        }

        const itemSpacingIn = typeof gangsheetItem.itemSpacingIn === "number" ? gangsheetItem.itemSpacingIn : undefined;
        const sheetMarginIn = typeof gangsheetItem.sheetMarginIn === "number" ? gangsheetItem.sheetMarginIn : undefined;

        /**
         * Cut lines that fall between graphics, not through them.
         *
         * Computed *before* any rendering now. They only need the placement
         * geometry, which is known from the items alone — and knowing them up
         * front is what lets each part be rendered as its own canvas instead of
         * being carved out of one enormous buffer. The cut arithmetic itself is
         * unchanged: same spans, same `computeGangsheetCuts`, same boundaries.
         */
        const spans = computeItemVerticalSpansIn({
          sheetWidthIn,
          artboardItems: fullResItems,
          itemSpacingIn,
          sheetMarginIn,
        });
        const cuts = computeGangsheetCuts({
          totalHeightIn: sheetHeightIn,
          spans,
          targetLengthIn: GANGSHEET_TARGET_LENGTH_IN,
        });
        const needsSplit = sheetHeightIn > GANGSHEET_TARGET_LENGTH_IN && cuts.length > 1;

        const renderWindow = (windowIn?: { topIn: number; heightIn: number }) =>
          exportGangsheetPng24({
            jobId: String(jobId),
            printerId: String(printerId),
            sheetWidthIn,
            sheetHeightIn,
            artboardItems: fullResItems,
            dpi: exportDpi,
            cropToContent: false,
            format: "png",
            itemSpacingIn,
            sheetMarginIn,
            renderWindowIn: windowIn
              ? { leftIn: 0, topIn: windowIn.topIn, widthIn: sheetWidthIn, heightIn: windowIn.heightIn }
              : null,
          });

        // The un-split sheet is still a single full-sheet render, unchanged.
        const rendered = needsSplit
          ? await renderWindow({ topIn: cuts[0].startIn, heightIn: cuts[0].endIn - cuts[0].startIn })
          : await renderWindow();

        setProgress(60, "Processing export...");

        const firstName = String(jobRaw.customer?.firstName || "").trim();
        const lastName = String(jobRaw.customer?.lastName || "").trim();
        const customerName = [firstName, lastName].filter(Boolean).join(" ") || "Customer";
        const safeName = customerName.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "Customer";
        const dtfRaw = jobRaw.displayId ? String(jobRaw.displayId) : `ORD-${String(jobId).slice(-4).toUpperCase()}`;
        // Strip non-alphanumeric but preserve the numeric part. E.g. "DTF-0171" → "0171", "ORD-AB12" → "AB12"
        const dtfNum = dtfRaw.replace(/^[A-Za-z]+-?/g, "").replace(/[^a-zA-Z0-9]/g, "") || dtfRaw.replace(/[^a-zA-Z0-9]/g, "");
        const baseFilename = `${safeName}_DTF${dtfNum}${sheetCount > 1 ? `_sheet${sheetIndex + 1}of${sheetCount}` : ""}`;

        const exportDir = path.join(process.cwd(), "uploads", "exports", "printers", String(printerId), String(jobId));
        await fs.promises.mkdir(exportDir, { recursive: true });

        let finalFilePath: string;
        let finalFileName: string;
        let finalByteSize: number;
        let finalFormat: "png" | "zip";

        if (!needsSplit) {
          setProgress(90, "Finalizing...");
          finalFilePath = rendered.filePath;
          finalFileName = `${baseFilename}.png`;
          finalByteSize = rendered.byteSize;
          finalFormat = "png";
        } else {
          const numParts = cuts.length;

          setProgress(65, `Splitting into ${numParts} part${numParts !== 1 ? "s" : ""}...`);

          const zipFilename = `${baseFilename}.zip`;
          const zipPath = path.join(exportDir, zipFilename);
          const zipOutput = fs.createWriteStream(zipPath);
          const zipArchive = archiver("zip", { zlib: { level: 6 } });
          zipArchive.pipe(zipOutput);

          for (let i = 0; i < numParts; i++) {
            const heightIn = cuts[i].endIn - cuts[i].startIn;
            if (!(heightIn > 0)) continue;

            const part =
              i === 0
                ? rendered
                : await renderWindow({ topIn: cuts[i].startIn, heightIn });

            const partBuf = await sharp(part.filePath, { limitInputPixels: false })
              .png({ compressionLevel: 1 })
              .withMetadata({ density: part.dpi })
              .toBuffer();

            zipArchive.append(partBuf, { name: `${baseFilename}_Part_${i + 1}.png` });
            setProgress(65 + Math.round(((i + 1) / numParts) * 20), `Processing part ${i + 1} of ${numParts}...`);
          }

          setProgress(86, "Creating ZIP...");

          await new Promise<void>((resolve, reject) => {
            zipOutput.on("close", resolve);
            zipOutput.on("error", reject);
            zipArchive.on("error", reject);
            zipArchive.finalize();
          });

          setProgress(94, "Saving...");
          const zipStats = await fs.promises.stat(zipPath);
          finalFilePath = zipPath;
          finalFileName = zipFilename;
          finalByteSize = zipStats.size;
          finalFormat = "zip";
        }

        const exportDoc = await GangsheetExport.create({
          jobId: new mongoose.Types.ObjectId(String(jobId)),
          printerId: new mongoose.Types.ObjectId(String(printerId)),
          format: finalFormat,
          dpi: rendered.dpi,
          sheet: rendered.sheet,
          fileName: finalFileName,
          filePath: finalFilePath,
          byteSize: finalByteSize,
          validation: rendered.validation,
          drive: { status: "skipped" },
        });

        await GangsheetExportAudit.create({
          exportId: exportDoc._id,
          jobId: exportDoc.jobId,
          printerId: exportDoc.printerId,
          action: "export_created",
          meta: { format: finalFormat, dpi: rendered.dpi },
        });

        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "done",
          progress: 100,
          message: "Complete",
          result: {
            exportId: String(exportDoc._id),
            dpi: rendered.dpi,
            sheet: rendered.sheet,
            validation: rendered.validation,
            drive: null,
          },
        });
      } catch (err: any) {
        console.error("[png-export] failed", { exportJobId, jobId, message: err?.message, stack: err?.stack });
        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "failed",
          error: err?.message || "Export failed",
        });
      }
    })().catch((err) => {
      console.error("[png-export] outer error", { exportJobId, err });
    });

    res.status(202).json({ exportJobId, status: "queued" });
  } catch (error) {
    next(error);
  }
};
