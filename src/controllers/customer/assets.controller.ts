import { Request, Response, NextFunction } from "express";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";
import { Asset } from "../../models/asset.model.js";
import sharp from "sharp";
import mongoose from "mongoose";
import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import { trimImage } from "../../utils/aiCrop.js";
import { uprightImage } from "../../utils/uprightImage.js";
import { isLegacyCloudinaryUrl, fetchStoredArtwork, isStoredArtworkUrl, legacyCloudinaryThumbUrl, storeArtwork } from "../../services/storage.service.js";
import { MAX_IMAGE_PIXELS } from "../../utils/imageBounds.js";
import { detectFade, TRANSPARENCY_CHECK_VERSION } from "../../services/fadeDetection.service.js";
import { CustomError, fetchImageBuffer } from "./shared.js";

/*
 * One rule now: the thumbnail sits beside the original under the same name.
 *
 * Cloudinary generated these by URL transformation, which plain storage cannot
 * do, so `storeArtwork` writes a second object at exactly this path on upload.
 * The convention already existed for local files — R2 follows it, which is why
 * the Cloudinary branch could go rather than be replaced.
 */
const computeThumbUrl = (assetUrl: string | null | undefined): string | null => {
  if (!assetUrl) return null;
  // Legacy Cloudinary assets never had a thumb object written beside them, so
  // they keep using the transformation that produced their thumbnails before.
  if (isLegacyCloudinaryUrl(assetUrl)) return legacyCloudinaryThumbUrl(assetUrl);
  const lastSlash = assetUrl.lastIndexOf("/");
  const lastDot = assetUrl.lastIndexOf(".");
  if (lastDot <= lastSlash) return null;
  return assetUrl.substring(0, lastDot) + "-thumb200.webp";
};

// Trim an image buffer using temp files. Returns the trimmed PNG as a Buffer.
// Temp files are written to os.tmpdir().

/**
 * Converts an embedded image into a hosted one.
 *
 * The editor produces every canvas result — auto-crop, background removal,
 * colour removal, sticker borders, local AI edits — as a
 * `data:image/png;base64,…` URL and writes it onto the artboard item. Those are
 * the artwork itself rather than a reference to it, and at print resolution
 * each runs to tens of megabytes. Carried into an order they are what makes the
 * request oversized.
 *
 * The artboard calls this as soon as such a result appears, so an item holds a
 * short URL long before checkout. That is the architectural fix: artwork is
 * uploaded once, when it is created, and every later request references it.
 *
 * Accepts raw bytes (`application/octet-stream`) as the primary path. Base64
 * inside JSON inflates by 4/3 and forces the whole string to be buffered and
 * JSON-parsed before a byte is usable; raw bytes avoid both. The JSON form is
 * still honoured so a client that has not reloaded keeps working.
 */
export const materializeAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      const { url: hostedUrl } = await storeArtwork(
        req.body,
        "space-transfers/edited",
      );
      return res.json({ url: hostedUrl, materialized: true, bytes: req.body.length });
    }

    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }

    // Already hosted — echoed back so the client can call this indiscriminately
    // rather than duplicating the "does this need uploading?" test everywhere.
    if (!url.startsWith("data:")) {
      return res.json({ url, materialized: false });
    }

    const buffer = await fetchImageBuffer(url);
    const { url: hostedUrl } = await storeArtwork(buffer, "space-transfers/edited");
    res.json({ url: hostedUrl, materialized: true, bytes: buffer.length });
  } catch (error) {
    next(error);
  }
};

export const trimAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      const error = new Error("url is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }
  
    /*
     * Accept stored artwork and legacy local /uploads/ paths.
     *
     * Matching on the R2 host rather than a bare "is it a URL" keeps this a
     * real check: it is the guard that stops an arbitrary address being handed
     * to the server to fetch.
     */
    const isLocal = url.includes("/uploads/");
    const isStored = isStoredArtworkUrl(url);
    if (!isLocal && !isStored) {
      const error = new Error("Invalid asset url") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Fetch the source image into a buffer.
    let sourceBuffer: Buffer;
    if (isLocal) {
      const marker = "/uploads/";
      const idx = url.lastIndexOf(marker);
      const safeFilename = path.basename(url.substring(idx + marker.length));
      const localPath = path.join(process.cwd(), "uploads", safeFilename);
      if (fs.existsSync(localPath)) {
        sourceBuffer = await fs.promises.readFile(localPath);
      } else {
        // File not on disk (e.g. from a different server); fetch via HTTP if absolute URL.
        if (!/^https?:\/\//i.test(url)) {
          const error = new Error("Asset file not found") as CustomError;
          error.statusCode = 404;
          throw error;
        }
        const r = await fetchStoredArtwork(url, 90_000, "Loading the image");
        if (!r.ok) {
          const error = new Error("Asset file not found") as CustomError;
          error.statusCode = 404;
          throw error;
        }
        sourceBuffer = Buffer.from(await r.arrayBuffer());
      }
    } else {
      const r = await fetchStoredArtwork(url, 90_000, "Loading the image");
      if (!r.ok) {
        const error = new Error("Asset file not found") as CustomError;
        error.statusCode = 404;
        throw error;
      }
      sourceBuffer = Buffer.from(await r.arrayBuffer());
    }

    const trim = await trimImage(sourceBuffer);
    if (!trim) {
      const error = new Error("This image could not be read to trim it.") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Nothing to trim: the stored image already is the trimmed one, so it is
    // reused rather than saved again as a much larger PNG.
    const trimmedUrl =
      trim.unchanged && isStoredArtworkUrl(url)
        ? url
        : (await storeArtwork(trim.unchanged ? sourceBuffer : trim.buffer, "space-transfers/trimmed")).url;

    const meta = await sharp(sourceBuffer, { limitInputPixels: false }).metadata();
    const normalizedDpi = Math.max(150, Math.round(meta.density || 300));
    const trimmedWidthPx = trim.widthPx || null;
    const trimmedHeightPx = trim.heightPx || null;
    const trimmedWidthIn = trimmedWidthPx ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : null;
    const trimmedHeightIn = trimmedHeightPx ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : null;

    res.json({ trimmedUrl, trimmedWidthPx, trimmedHeightPx, trimmedWidthIn, trimmedHeightIn });
  } catch (error) {
    next(error);
  }
};

// ── AI Upscale ──────────────────────────────────────────────────────────────

// ── Upscaling constants ───────────────────────────────────────────────────────

const MAX_OUTPUT_PX = 8_000; // prevent runaway output sizes

/**
 * Post-processes any upscaled buffer with a light unsharp mask.
 * AI models produce inherently sharper results so the pass is gentler;
 * the pure-sharp fallback gets a stronger pass because interpolation
 * introduces softness that must be compensated.
 */
/*
 * Replicate and HuggingFace upscaling tiers removed.
 *
 * Neither is provisioned in production — the deployment blueprint declares only
 * GEMINI_API_KEY — so both were a paid dependency and a free-tier dependency
 * that would never have had credentials, falling through to sharp on every
 * request while looking like a working three-tier chain.
 *
 * Sharp is now the whole implementation: local, free, no key, and no image
 * leaving the server to a third party.
 */

// ── Tier 3: Sharp multi-pass with unsharp mask (no API key needed) ────────────
//
// Single-pass Lanczos3 at high scale factors produces visible softness because
// the interpolation has no information to reconstruct missing detail.
// Breaking the upscale into 2× passes and applying an unsharp mask after each
// pass significantly improves perceived sharpness for print materials.

async function upscaleWithSharp(
  sourceBuffer: Buffer,
  originalWidthPx: number,
  originalHeightPx: number,
  scale: number,
): Promise<Buffer> {
  // Cap output dimensions so we don't produce gigapixel images.
  const maxScale = MAX_OUTPUT_PX / Math.max(originalWidthPx, originalHeightPx, 1);
  const clampedScale = Math.min(scale, maxScale);

  let buf = sourceBuffer;
  let currentW = originalWidthPx;
  let currentH = originalHeightPx;
  const targetW = Math.round(originalWidthPx * clampedScale);
  const targetH = Math.round(originalHeightPx * clampedScale);

  // Multi-pass: each pass doubles the size and applies an unsharp mask.
  // This is substantially better than a single large resize because each pass
  // restores edge information that would otherwise be averaged away.
  while (currentW < targetW || currentH < targetH) {
    const nextW = Math.min(currentW * 2, targetW);
    const nextH = Math.min(currentH * 2, targetH);
    buf = await sharp(buf, { limitInputPixels: false })
      .resize(nextW, nextH, { kernel: sharp.kernel.lanczos3, fastShrinkOnLoad: false })
      // Unsharp mask: moderate sigma keeps fine detail, low m2 avoids haloing.
      .sharpen({ sigma: 0.9, m1: 2.0, m2: 0.7 })
      .png({ compressionLevel: 6 })
      .toBuffer();
    currentW = nextW;
    currentH = nextH;
  }

  return buf;
}

// ── Main export ───────────────────────────────────────────────────────────────

export const upscaleAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url, scale: rawScale } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }

    const scale = Math.min(8, Math.max(2, Math.round(Number(rawScale) || 2)));

    const sourceBuffer = await fetchImageBuffer(url);
    const originalMeta = await sharp(sourceBuffer, { limitInputPixels: false }).metadata();
    const originalWidthPx = originalMeta.width ?? 0;
    const originalHeightPx = originalMeta.height ?? 0;

    // One implementation, so no tier to choose and nothing to fall through to.
    const upscaledBuffer = await upscaleWithSharp(
      sourceBuffer,
      originalWidthPx,
      originalHeightPx,
      scale,
    );
    const tier = "sharp";

    console.log(`[UPSCALE] ${tier} — ${originalWidthPx}×${originalHeightPx} → scale ${scale}`);

    const { url: upscaledUrl } = await storeArtwork(upscaledBuffer, "space-transfers/upscaled");
    const upscaledMeta = await sharp(upscaledBuffer, { limitInputPixels: false }).metadata();

    res.json({
      upscaledUrl,
      originalWidthPx,
      originalHeightPx,
      widthPx: upscaledMeta.width ?? Math.round(originalWidthPx * scale),
      heightPx: upscaledMeta.height ?? Math.round(originalHeightPx * scale),
      scale,
      tier,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * AI fade check for an already-uploaded asset.
 *
 * Separate from the upload response so the artboard can re-check an image after
 * an edit that could introduce or remove a fade — a background removal or a
 * generative repaint both change the alpha channel — without re-uploading it.
 */
export const fadeCheckAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }

    const buffer = await fetchImageBuffer(url);
    const result = await detectFade(buffer);

    console.log(
      `[FADE] ${result.kind} hasFade=${result.hasFade} ` +
        `confidence=${result.confidence.toFixed(2)} via ${result.source}`,
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const uploadAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      const error = new Error("No file uploaded") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const rawBuffer = req.file.buffer;

    // Deduplication: if this user already uploaded the exact same file, reuse it.
    const contentHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
    const foundAsset = req.user?.id ? await Asset.findOne({
      user: new mongoose.Types.ObjectId(String(req.user.id)),
      contentHash,
    }).lean() as any : null;

    const localUrlAccessible = (url: string | null | undefined): boolean => {
      if (!url || !url.includes("/uploads/")) return true;
      const marker = "/uploads/";
      const idx = url.indexOf(marker);
      if (idx === -1) return true;
      const filename = url.substring(idx + marker.length).split("?")[0];
      if (!filename || filename.includes("..")) return false;
      return fs.existsSync(path.join(process.cwd(), "uploads", filename));
    };

    // Track stale asset ID so we update rather than insert a duplicate when re-processing.
    let staleAssetId: string | null = null;

    if (foundAsset) {
      if (localUrlAccessible(foundAsset.url) && localUrlAccessible(foundAsset.trimmedUrl)) {
        const thumbUrl = computeThumbUrl(foundAsset.trimmedUrl || foundAsset.url);
        const normDpi = foundAsset.dpi || 300;
        /**
         * Reuse the stored verdict unless it was reached under older rules (or
         * none). Identical bytes cannot produce a different answer under the same
         * rules, so re-running the model would spend a call to reproduce a result
         * we already have — while a verdict from before a rule change would
         * silently keep missing what the new rule catches.
         */
        const fadeIsCurrent = foundAsset.fade?.version === TRANSPARENCY_CHECK_VERSION;
        const cachedFade = fadeIsCurrent ? foundAsset.fade : await detectFade(rawBuffer);
        if (!fadeIsCurrent) {
          await Asset.findByIdAndUpdate(foundAsset._id, { fade: cachedFade }).catch(() => {
            // A failed backfill is not worth failing the upload over; the
            // verdict is still returned and will be recomputed next time.
          });
        }
        return res.json({
          id: String(foundAsset._id),
          url: foundAsset.url,
          trimmedUrl: foundAsset.trimmedUrl || null,
          thumbnailUrl: thumbUrl,
          originalFilename: foundAsset.originalFilename,
          sizeBytes: foundAsset.sizeBytes,
          widthPx: foundAsset.widthPx,
          heightPx: foundAsset.heightPx,
          dpi: normDpi,
          widthIn: foundAsset.widthPx ? +(foundAsset.widthPx / normDpi).toFixed(4) : undefined,
          heightIn: foundAsset.heightPx ? +(foundAsset.heightPx / normDpi).toFixed(4) : undefined,
          trimmedWidthPx: foundAsset.trimmedWidthPx || null,
          trimmedHeightPx: foundAsset.trimmedHeightPx || null,
          trimmedWidthIn: foundAsset.trimmedWidthPx ? +(foundAsset.trimmedWidthPx / normDpi).toFixed(4) : null,
          trimmedHeightIn: foundAsset.trimmedHeightPx ? +(foundAsset.trimmedHeightPx / normDpi).toFixed(4) : null,
          deduplicated: true,
          fade: cachedFade,
        });
      }
      // Stored URLs are stale local paths — re-process and update the existing record.
      staleAssetId = String(foundAsset._id);
    }

    /**
     * Decode check, before anything is stored.
     *
     * A file whose contents are not really an image — a partly-downloaded or
     * damaged file, which typically still carries its original extension — used
     * to travel a long way through this handler. It was uploaded to storage,
     * its metadata extraction failed into a swallowed `catch`, and the response
     * went back as a **201 with `widthPx: undefined`**. The client then computed
     * `undefined / dpi`, and placed an item on the sheet whose physical size was
     * NaN: no error anywhere, and a gang sheet that cannot be printed.
     *
     * So this is now a hard 400, and it runs *before* the upload —
     * there is no reason to spend the round trip and the storage on a file that
     * is about to be rejected.
     *
     */
    let widthPx: number | undefined, heightPx: number | undefined, dpi: number | undefined;

    /*
     * PDFs are refused as artwork. A stored PDF cannot be printed: sharp in this
     * build has no PDF support, so the export pipeline dropped PDF items from
     * the sheet without a word. The editor renders each page to a PNG before
     * uploading (`pdfRasterize.ts`), so only a caller bypassing it lands here.
     *
     * Checked by signature as well as type, so a PDF renamed .png gets this
     * message rather than "could not be read".
     */
    /*
     * SVG likewise: the editor renders it to a PNG at its real size before
     * uploading, so the print pipeline only ever composites raster artwork.
     */
    const head = rawBuffer.subarray(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
    if (req.file.mimetype === "image/svg+xml" || head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
      const error = new Error(
        `“${req.file.originalname}” is an SVG. Add it from the editor, which converts it to an image at its real size, or upload a PNG or JPG.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (
      req.file.mimetype === "application/pdf" ||
      rawBuffer.subarray(0, 5).toString("latin1") === "%PDF-"
    ) {
      const error = new Error(
        `“${req.file.originalname}” is a PDF. Add it from the editor, which converts each page to an image, or upload a PNG or JPG.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Upright before anything reads its size; see `uprightImage`.
    let fileBuffer = rawBuffer;
    try {
      fileBuffer = await uprightImage(rawBuffer);
      const metadata = await sharp(fileBuffer, { limitInputPixels: false }).metadata();
      widthPx = metadata.width;
      heightPx = metadata.height;
      dpi = metadata.density || 300;
    } catch (err: any) {
      console.warn(`[UPLOAD] rejected ${req.file.originalname}: ${err?.message}`);
    }

    // Dimensions are the test, not merely whether metadata() threw: some
    // malformed files parse far enough to return an object with no width or
    // height, and that is exactly the shape that produced the NaN item.
    if (!widthPx || !heightPx) {
      const error = new Error(
        `“${req.file.originalname}” could not be read — the file may be damaged or only partly downloaded. Please re-export it and try again.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Every sharp call here passes `limitInputPixels: false` to allow
    // legitimately huge gang sheets, which also removes the guard against a
    // decompression bomb. Without an explicit ceiling, a 50000×50000 PNG
    // decodes to ~10 GB and the process is killed by the OS rather than
    // returning an error.
    if (widthPx * heightPx > MAX_IMAGE_PIXELS) {
      console.error(
        `[UPLOAD] rejected ${req.file.originalname}: ${widthPx}×${heightPx} exceeds ` +
          `the ${MAX_IMAGE_PIXELS.toLocaleString()} px ceiling`,
      );
      const error = new Error(
        `“${req.file.originalname}” is too large to process (${widthPx}×${heightPx}). ` +
          `Please re-export it at a smaller resolution.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * Store the original, find the trim and run the fade check at the same time
     * — they only read the same bytes. They ran one after another, and with the
     * old trim re-encoding the whole image as PNG twice, a phone photo spent
     * seconds of CPU before the customer saw anything.
     */
    const [{ url: fileUrl }, trim, fade] = await Promise.all([
      storeArtwork(fileBuffer, "space-transfers/assets"),
      trimImage(fileBuffer).catch((e: any) => {
        console.warn(`[UPLOAD] trim failed for ${req.file!.originalname}: ${e?.message}`);
        return null;
      }),
      detectFade(fileBuffer),
    ]);

    const normalizedDpi = (!dpi || dpi < 150) ? 300 : dpi;
    const widthIn = widthPx && normalizedDpi ? +(widthPx / normalizedDpi).toFixed(4) : undefined;
    const heightIn = heightPx && normalizedDpi ? +(heightPx / normalizedDpi).toFixed(4) : undefined;

    // Trim and store the trimmed version alongside it.
    let trimmedUrl: string | undefined;
    let trimmedWidthPx: number | undefined;
    let trimmedHeightPx: number | undefined;
    let trimmedWidthIn: number | undefined;
    let trimmedHeightIn: number | undefined;
    try {
      if (trim) {
        // Nothing to trim (most photos): the original is the trimmed copy.
        trimmedUrl = trim.unchanged ? fileUrl : (await storeArtwork(trim.buffer, "space-transfers/trimmed")).url;
        trimmedWidthPx = trim.widthPx;
        trimmedHeightPx = trim.heightPx;
        trimmedWidthIn = trimmedWidthPx && normalizedDpi ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : undefined;
        trimmedHeightIn = trimmedHeightPx && normalizedDpi ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : undefined;
      }
    } catch {
      trimmedUrl = undefined;
    }

    // The thumbnail is written beside the original by storeArtwork, at the
    // path computeThumbUrl derives — nothing to generate here.
    const thumbnailUrl = computeThumbUrl(trimmedUrl || fileUrl);

    // The fade check ran alongside the upload above, on the buffer already in
    // memory — the client would otherwise re-download its own upload to inspect
    // the alpha channel. It short-circuits on images with no meaningful partial
    // alpha, so the common upload pays a few milliseconds and never reaches the model.
    if (fade.hasFade) {
      console.log(
        `[FADE] ${req.file.originalname}: ${fade.kind} ` +
          `confidence=${fade.confidence.toFixed(2)} via ${fade.source}`,
      );
    }

    // Guest uploads: return metadata without persisting to the database
    if (!req.user?.id) {
      return res.status(201).json({
        url: fileUrl,
        trimmedUrl: trimmedUrl || null,
        thumbnailUrl,
        originalFilename: req.file.originalname,
        sizeBytes: req.file.size,
        widthPx,
        heightPx,
        dpi: normalizedDpi,
        widthIn,
        heightIn,
        trimmedWidthPx: trimmedWidthPx || null,
        trimmedHeightPx: trimmedHeightPx || null,
        trimmedWidthIn: trimmedWidthIn || null,
        trimmedHeightIn: trimmedHeightIn || null,
        fade,
      });
    }

    let savedAssetId: string;
    if (staleAssetId) {
      await Asset.findByIdAndUpdate(staleAssetId, {
        url: fileUrl,
        trimmedUrl,
        widthPx,
        heightPx,
        trimmedWidthPx,
        trimmedHeightPx,
        dpi: normalizedDpi,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        fade,
      });
      savedAssetId = staleAssetId;
    } else {
      const asset = new Asset({
        user: req.user.id,
        url: fileUrl,
        trimmedUrl,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        widthPx,
        heightPx,
        trimmedWidthPx,
        trimmedHeightPx,
        dpi: normalizedDpi,
        contentHash,
        fade,
      });
      await asset.save();
      savedAssetId = asset.id;
    }

    res.status(201).json({
      id: savedAssetId,
      url: fileUrl,
      trimmedUrl: trimmedUrl || null,
      thumbnailUrl,
      originalFilename: req.file.originalname,
      sizeBytes: req.file.size,
      widthPx,
      heightPx,
      dpi: normalizedDpi,
      widthIn,
      heightIn,
      trimmedWidthPx: trimmedWidthPx || null,
      trimmedHeightPx: trimmedHeightPx || null,
      trimmedWidthIn: trimmedWidthIn || null,
      trimmedHeightIn: trimmedHeightIn || null,
      fade,
    });
  } catch (error) {
    next(error);
  }
};

export const listAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pageSize = Math.max(1, Math.min(500, parseInt(String(req.query.limit || "200"), 10) || 200));
    const cursor = typeof req.query.cursor === "string" && mongoose.Types.ObjectId.isValid(req.query.cursor)
      ? req.query.cursor
      : null;

    const query: any = { user: req.user?.id };
    if (cursor) query._id = { $lt: new mongoose.Types.ObjectId(cursor) };

    // Fetch one extra to detect whether a next page exists.
    const assets = await Asset.find(query)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .select("url trimmedUrl originalFilename sizeBytes widthPx heightPx trimmedWidthPx trimmedHeightPx dpi");

    const hasMore = assets.length > pageSize;
    const page = hasMore ? assets.slice(0, pageSize) : assets;
    const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;

    const items = page.map((asset) => ({
      id: asset.id,
      url: asset.url,
      trimmedUrl: asset.trimmedUrl || null,
      thumbnailUrl: computeThumbUrl(asset.trimmedUrl || asset.url),
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      trimmedWidthPx: asset.trimmedWidthPx || null,
      trimmedHeightPx: asset.trimmedHeightPx || null,
      dpi: asset.dpi,
    }));

    res.json({ items, nextCursor });
  } catch (error) {
    next(error);
  }
};
