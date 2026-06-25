import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import sharp from "sharp";
import mongoose from "mongoose";
import { Asset } from "../models/asset.model.js";

const SHEET_DEFAULT_WIDTH_IN = 23.5;
const SHEET_DEFAULT_HEIGHT_IN = 23.5;
const GROUP_GAP_IN = 0.06;
const CROP_PADDING_IN = 0.08;

const isObjectIdString = (v: string) => /^[0-9a-fA-F]{24}$/.test(String(v || ""));

// Concurrency limiter — prevents simultaneous large exports from exhausting memory.
const MAX_CONCURRENT_RENDERS = 3;
let _activeRenders = 0;
const _renderQueue: Array<() => void> = [];

const acquireRenderSlot = (): Promise<void> =>
  new Promise<void>((resolve) => {
    if (_activeRenders < MAX_CONCURRENT_RENDERS) {
      _activeRenders++;
      resolve();
    } else {
      _renderQueue.push(() => { _activeRenders++; resolve(); });
    }
  });

const releaseRenderSlot = (): void => {
  _activeRenders--;
  const next = _renderQueue.shift();
  if (next) next();
};

const looksLikeUrlOrPath = (v: string) => {
  const s = String(v || "");
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith("/uploads/")) return true;
  if (s.includes("/uploads/")) return true;
  return false;
};

const resolveLocalUploadPath = (url: string) => {
  const marker = "/uploads/";
  const idx = url.lastIndexOf(marker);
  if (idx === -1) return null;
  const filename = url.substring(idx + marker.length);
  const safeFilename = path.basename(filename);
  return path.join(process.cwd(), "uploads", safeFilename);
};

const loadImageBuffer = async (url: string) => {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:[^;]+;base64,(.+)$/s);
    if (match?.[1]) return Buffer.from(match[1], "base64");
    return null;
  }

  // Always try the local filesystem first — this works even when the stored URL
  // has the wrong host/port (e.g. http://localhost:4000 stored from a dev session).
  const local = resolveLocalUploadPath(url);
  if (local && fs.existsSync(local)) {
    return fs.promises.readFile(local);
  }

  // For localhost URLs where the file isn't on disk, skip the HTTP fetch entirely
  // — it will always fail on Heroku since the port stored in the URL differs from
  // the current dyno port. Return null so the item is gracefully skipped.
  if (/^https?:\/\/localhost/i.test(url)) {
    console.warn(`[gangsheet] skipping localhost asset not found on disk: ${url}`);
    return null;
  }

  if (/^https?:\/\//i.test(url)) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20_000);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`failed_to_fetch_asset:${res.status}`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } finally {
      clearTimeout(t);
    }
  }

  return null;
};

// Fast cache-key for large item arrays — hashes each item's fields individually
// with XOR-folding so the full array is never JSON-stringified into one huge string.
const computeItemsHash = (items: Array<{
  assetId: string; croppedUrl: string; widthIn: number; heightIn: number;
  posX: number; posY: number; rotation: number; flipped: boolean; copies: number;
}>): string => {
  const h = crypto.createHash("sha1");
  h.update(`n=${items.length};`);
  for (const it of items) {
    h.update(`${it.assetId}|${it.croppedUrl}|${it.widthIn}|${it.heightIn}|${it.posX}|${it.posY}|${it.rotation}|${it.flipped ? 1 : 0}|${it.copies};`);
  }
  return h.digest("hex");
};

const computeCacheKey = (payload: {
  v: number; jobId: string; printerId: string; dpi: number;
  sheet: { widthIn: number; heightIn: number }; cropToContent: boolean;
  crop: any; itemsHash: string; png: any; gapIn: number; marginIn: number;
}) => {
  const raw = `v=${payload.v};job=${payload.jobId};printer=${payload.printerId};dpi=${payload.dpi};`
    + `sheet=${payload.sheet.widthIn}x${payload.sheet.heightIn};crop=${payload.cropToContent};`
    + `cropRect=${JSON.stringify(payload.crop)};items=${payload.itemsHash};png=${JSON.stringify(payload.png)};`
    + `gap=${payload.gapIn};margin=${payload.marginIn}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
};

const computeRotatedBounds = (wIn: number, hIn: number, rotationDeg: number) => {
  const r = ((Number(rotationDeg) || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const w = Math.abs(wIn * c) + Math.abs(hIn * s);
  const h = Math.abs(wIn * s) + Math.abs(hIn * c);
  return { wIn: w, hIn: h };
};

const computeContentBoundsIn = ({
  sheetWidthIn,
  sheetHeightIn,
  artboardItems,
  itemSpacingIn,
  sheetMarginIn,
}: {
  sheetWidthIn: number;
  sheetHeightIn: number;
  artboardItems: Array<{
    widthIn: number;
    heightIn: number;
    posX: number;
    posY: number;
    rotation?: number;
    copies?: number;
  }>;
  itemSpacingIn?: number | null;
  sheetMarginIn?: number | null;
}) => {
  const gapIn = typeof itemSpacingIn === "number" && itemSpacingIn >= 0 ? itemSpacingIn : GROUP_GAP_IN;
  const marginIn = typeof sheetMarginIn === "number" && sheetMarginIn >= 0 ? sheetMarginIn : 0;
  const effectiveWidthIn = sheetWidthIn - 2 * marginIn;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const it of artboardItems) {
    const copies = Math.max(1, Number(it.copies || 1));
    const wIn = Math.max(0, Number(it.widthIn || 0));
    const hIn = Math.max(0, Number(it.heightIn || 0));
    if (!(wIn > 0) || !(hIn > 0)) continue;

    const rotation = typeof it.rotation === "number" ? it.rotation : 0;
    const rotated = computeRotatedBounds(wIn, hIn, rotation);

    const capacityCols = Math.max(1, Math.floor((effectiveWidthIn + gapIn) / Math.max(1e-6, wIn + gapIn)));
    const cols = Math.max(1, Math.min(copies, capacityCols));

    for (let idx = 0; idx < copies; idx++) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const xIn = Number(it.posX || 0) + col * (wIn + gapIn);
      const yIn = Number(it.posY || 0) + row * (hIn + gapIn);

      const cx = xIn + wIn / 2;
      const cy = yIn + hIn / 2;

      const left = cx - rotated.wIn / 2;
      const top = cy - rotated.hIn / 2;
      const right = cx + rotated.wIn / 2;
      const bottom = cy + rotated.hIn / 2;

      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  if (!(maxX > minX) || !(maxY > minY)) return null;

  const paddedLeft = Math.max(0, minX - CROP_PADDING_IN);
  const paddedTop = Math.max(0, minY - CROP_PADDING_IN);
  const paddedRight = Math.min(sheetWidthIn, maxX + CROP_PADDING_IN);
  const paddedBottom = Math.min(sheetHeightIn, maxY + CROP_PADDING_IN);

  const width = Math.max(0.01, paddedRight - paddedLeft);
  const height = Math.max(0.01, paddedBottom - paddedTop);

  return { leftIn: paddedLeft, topIn: paddedTop, widthIn: width, heightIn: height };
};

export const exportGangsheetPng24 = async ({
  jobId,
  printerId,
  sheetWidthIn,
  sheetHeightIn,
  artboardItems,
  dpi: dpiInput,
  cropToContent = false,
  maxComposites,
  format = "png",
  itemSpacingIn,
  sheetMarginIn,
}: {
  jobId: string;
  printerId: string;
  sheetWidthIn?: number | null;
  sheetHeightIn?: number | null;
  artboardItems: Array<{
    assetId: string;
    croppedUrl?: string;
    widthIn: number;
    heightIn: number;
    posX: number;
    posY: number;
    rotation?: number;
    flipped?: boolean;
    copies?: number;
  }>;
  dpi: number;
  cropToContent?: boolean;
  /** Preview-mode cap: stop adding composites after this many. Omit for full export. */
  maxComposites?: number;
  /** Output format. 'webp' for browser previews (5-10x smaller); 'png' (default) for DTF print export. */
  format?: "png" | "webp";
  /** Inter-copy gap in inches — must match the artboard spacing setting. Defaults to GROUP_GAP_IN if omitted. */
  itemSpacingIn?: number | null;
  /** Left/right margin in inches — must match the artboard margin setting. Defaults to 0 if omitted. */
  sheetMarginIn?: number | null;
}): Promise<{
  fileName: string;
  filePath: string;
  relativePath: string;
  byteSize: number;
  dpi: number;
  sheet: { widthIn: number; heightIn: number };
  validation: { ok: boolean; errors: string[]; meta?: any };
  cacheKey: string;
  cacheHit: boolean;
  crop: { leftIn: number; topIn: number; widthIn: number; heightIn: number } | null;
}> => {
  await acquireRenderSlot();
  try {
  return await _doExport({ jobId, printerId, sheetWidthIn, sheetHeightIn, artboardItems, dpi: dpiInput, cropToContent, maxComposites, format, itemSpacingIn, sheetMarginIn });
  } finally {
    releaseRenderSlot();
  }
};

const _doExport = async ({
  jobId, printerId, sheetWidthIn, sheetHeightIn, artboardItems, dpi: dpiInput,
  cropToContent = false, maxComposites, format = "png", itemSpacingIn, sheetMarginIn,
}: {
  jobId: string; printerId: string; sheetWidthIn?: number | null; sheetHeightIn?: number | null;
  artboardItems: Array<{ assetId: string; croppedUrl?: string; widthIn: number; heightIn: number;
    posX: number; posY: number; rotation?: number; flipped?: boolean; copies?: number }>;
  dpi: number; cropToContent?: boolean; maxComposites?: number; format?: "png" | "webp";
  itemSpacingIn?: number | null; sheetMarginIn?: number | null;
}) => {
  const rawDpi = Math.max(10, Math.min(1200, Math.round(Number(dpiInput) || 600)));
  const widthIn = Number(sheetWidthIn || SHEET_DEFAULT_WIDTH_IN) || SHEET_DEFAULT_WIDTH_IN;
  const heightIn = Number(sheetHeightIn || SHEET_DEFAULT_HEIGHT_IN) || SHEET_DEFAULT_HEIGHT_IN;
  const gapIn = typeof itemSpacingIn === "number" && itemSpacingIn >= 0 ? itemSpacingIn : GROUP_GAP_IN;
  const marginIn = typeof sheetMarginIn === "number" && sheetMarginIn >= 0 ? sheetMarginIn : 0;
  const effectiveWidthIn = widthIn - 2 * marginIn;

  const normalizedItems = (Array.isArray(artboardItems) ? artboardItems : [])
    .map((it) => ({
      assetId: String(it.assetId || ""),
      croppedUrl: it.croppedUrl ? String(it.croppedUrl) : "",
      widthIn: Number(it.widthIn || 0),
      heightIn: Number(it.heightIn || 0),
      posX: Number(it.posX || 0),
      posY: Number(it.posY || 0),
      rotation: typeof it.rotation === "number" ? it.rotation : 0,
      flipped: it.flipped === true,
      copies: Math.max(1, Number(it.copies || 1)),
    }))
    .sort((a, b) => {
      if (a.assetId !== b.assetId) return a.assetId.localeCompare(b.assetId);
      if (a.croppedUrl !== b.croppedUrl) return a.croppedUrl.localeCompare(b.croppedUrl);
      if (a.posX !== b.posX) return a.posX - b.posX;
      if (a.posY !== b.posY) return a.posY - b.posY;
      if (a.widthIn !== b.widthIn) return a.widthIn - b.widthIn;
      if (a.heightIn !== b.heightIn) return a.heightIn - b.heightIn;
      if (a.rotation !== b.rotation) return a.rotation - b.rotation;
      return a.copies - b.copies;
    });

  const crop = cropToContent
    ? computeContentBoundsIn({
        sheetWidthIn: widthIn,
        sheetHeightIn: heightIn,
        artboardItems: normalizedItems,
        itemSpacingIn: gapIn,
        sheetMarginIn: marginIn,
      })
    : null;

  const outputSheetWidthIn = crop ? crop.widthIn : widthIn;
  const outputSheetHeightIn = crop ? crop.heightIn : heightIn;

  // Auto-cap DPI so the render stays within memory + encoder limits. Without this,
  // long roll sheets (e.g. 22" × 1180") throw "Sheet too large" at 300 DPI before
  // any pixels are drawn. WebP also has a hard 16383-pixel per-dimension limit.
  const MAX_BUFFER_BYTES = 2 * 1024 * 1024 * 1024;
  const dpi = (() => {
    const areaSqIn = outputSheetWidthIn * outputSheetHeightIn;
    const maxFromBuffer = areaSqIn > 0
      ? Math.floor(Math.sqrt(MAX_BUFFER_BYTES / 4 / areaSqIn))
      : rawDpi;
    if (format === "webp") {
      const MAX_WEBP_DIM = 16383;
      const maxFromWidth = Math.floor(MAX_WEBP_DIM / outputSheetWidthIn);
      const maxFromHeight = Math.floor(MAX_WEBP_DIM / outputSheetHeightIn);
      return Math.max(10, Math.min(rawDpi, maxFromWidth, maxFromHeight, maxFromBuffer));
    }
    return Math.max(10, Math.min(rawDpi, maxFromBuffer));
  })();
  if (dpi < rawDpi) {
    console.warn(`[gangsheet] capped DPI ${rawDpi}→${dpi} for ${outputSheetWidthIn.toFixed(1)}"×${outputSheetHeightIn.toFixed(1)}" sheet`);
  }

  const widthPx = Math.max(1, Math.round(outputSheetWidthIn * dpi));
  const heightPx = Math.max(1, Math.round(outputSheetHeightIn * dpi));

  // Cap items used for the cache key to maxComposites so we never stringify 10k+ items.
  const capForKey = typeof maxComposites === "number" && maxComposites > 0 ? maxComposites : normalizedItems.length;
  const itemsHash = computeItemsHash(normalizedItems.slice(0, capForKey));
  const cacheKey = computeCacheKey({
    v: 8,
    jobId,
    printerId,
    dpi,
    sheet: { widthIn, heightIn },
    cropToContent,
    crop,
    itemsHash,
    png: format === "webp"
      ? { format: "webp", lossless: true, effort: 6 }
      : { format: "png", compressionLevel: 9, adaptiveFiltering: true, effort: 10, normTransparent: true },
    gapIn,
    marginIn,
  });

  const fileName = `gangsheet_${jobId}_${dpi}dpi_${cacheKey.slice(0, 12)}.${format}`;
  const exportDir = path.join(process.cwd(), "uploads", "exports", "printers", printerId, jobId);
  await fs.promises.mkdir(exportDir, { recursive: true });
  const filePath = path.join(exportDir, fileName);
  const relativePath = `/uploads/exports/printers/${printerId}/${jobId}/${fileName}`;

  if (fs.existsSync(filePath)) {
    const stats = await fs.promises.stat(filePath);
    return {
      fileName,
      filePath,
      relativePath,
      byteSize: stats.size,
      dpi,
      sheet: { widthIn: outputSheetWidthIn, heightIn: outputSheetHeightIn },
      validation: { ok: true, errors: [], meta: { cached: true } },
      cacheKey,
      cacheHit: true,
      crop,
    };
  }

  const base = sharp({
    create: {
      width: widthPx,
      height: heightPx,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    limitInputPixels: false,
  });

  type Placement = { data: Buffer; srcW: number; srcH: number; left: number; top: number };
  const placements: Placement[] = [];
  const sourceResolutionErrors: string[] = [];
  const compositesCap = typeof maxComposites === "number" && maxComposites > 0 ? maxComposites : Infinity;

  // All items are candidates — the dedup cache below ensures each unique image
  // is loaded exactly ONCE regardless of how many artboard items reference it.
  const itemsToLoad = normalizedItems;

  // Deduplicate asset ObjectIds across all items — one DB round-trip for all.
  const unresolvedIds = Array.from(
    new Set(
      itemsToLoad
        .filter((it) => !it.croppedUrl && isObjectIdString(it.assetId))
        .map((it) => it.assetId),
    ),
  );

  const resolvedMap = new Map<string, string>();
  if (unresolvedIds.length > 0) {
    const found = await Asset.find({ _id: { $in: unresolvedIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select("url trimmedUrl")
      .lean();
    for (const a of found as any[]) {
      const id = String(a._id);
      const url = String(a.trimmedUrl || a.url || "");
      if (url) resolvedMap.set(id, url);
    }
  }

  // Dedup buffer cache — keyed by (srcUrl | widthPx | heightPx | rotation).
  // A Promise is stored so concurrent callers waiting on the same key share one load.
  type CachedBuf = { data: Buffer; info: { width: number; height: number } };
  const bufCache = new Map<string, Promise<CachedBuf | null>>();

  const resolveUrl = (it: (typeof normalizedItems)[number]): string => {
    let u = String(it.croppedUrl || "");
    if (!u) u = looksLikeUrlOrPath(it.assetId) ? it.assetId : (resolvedMap.get(it.assetId) || "");
    return u;
  };

  const prepareUnique = (srcUrl: string, wPx: number, hPx: number, rot: number, flipped: boolean, assetId: string): Promise<CachedBuf | null> => {
    // Include flipped in the dedup key — a flipped and non-flipped version of the same
    // image at the same size are two distinct buffers.
    const key = `${srcUrl}|${wPx}|${hPx}|${rot}|${flipped ? 1 : 0}`;
    const hit = bufCache.get(key);
    if (hit) return hit;
    const p = (async (): Promise<CachedBuf | null> => {
      try {
        const buf = await loadImageBuffer(srcUrl);
        if (!buf) return null;
        const meta = await sharp(buf, { limitInputPixels: false }).metadata();
        const srcW = typeof meta.width  === "number" && meta.width  > 0 ? meta.width  : wPx;
        const srcH = typeof meta.height === "number" && meta.height > 0 ? meta.height : hPx;

        if (srcW < wPx || srcH < hPx) {
          // Source has fewer pixels than the target slot — upscaling will occur.
          // This normally means the export DPI exceeds the image's native DPI.
          // The printer controller caps exportDpi to min(trimmedWidthPx/widthIn) so
          // this should only fire for canvas-processed items (data URLs) where the
          // DB-stored trimmedWidthPx differs from the actual canvas crop pixel count.
          sourceResolutionErrors.push(`asset_${assetId}_insufficient_px`);
        }

        // Apply transforms in the same order as the artboard CSS:
        //   transform: scaleX(-1) rotate(Xdeg)
        // CSS applies right-to-left: rotate first, then flip. Sharp mirrors this:
        //   resize → rotate → flop (horizontal flip).
        //
        // Skip resize entirely when the source already matches the target dimensions.
        // Even a 1:1 resize through lanczos3 runs the resampling kernel and introduces
        // sub-pixel rounding differences; skipping it preserves the original pixel data
        // exactly and is the largest single factor in export sharpness.
        let pipeline = sharp(buf, { limitInputPixels: false });
        if (srcW !== wPx || srcH !== hPx) {
          pipeline = pipeline.resize(wPx, hPx, { fit: "fill", kernel: "lanczos3" });
        }
        pipeline = pipeline.rotate(rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        if (flipped) pipeline = pipeline.flop();
        const out = await pipeline
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        return { data: out.data, info: { width: out.info.width, height: out.info.height } };
      } catch (err: any) {
        console.warn(`[gangsheet] skipping unloadable image (${assetId}): ${err?.message}`);
        return null;
      }
    })();
    bufCache.set(key, p);
    return p;
  };

  // Phase 1 — kick off all unique image loads in parallel (batched 16 at a time).
  const uniqueKeys = new Set<string>();
  const uniqueJobs: Promise<CachedBuf | null>[] = [];
  for (const it of itemsToLoad) {
    const wIn = Math.max(0, Number(it.widthIn || 0));
    const hIn = Math.max(0, Number(it.heightIn || 0));
    if (!(wIn > 0) || !(hIn > 0)) continue;
    const srcUrl = resolveUrl(it);
    if (!srcUrl) continue;
    const key = `${srcUrl}|${Math.round(wIn * dpi)}|${Math.round(hIn * dpi)}|${it.rotation ?? 0}|${it.flipped ? 1 : 0}`;
    if (!uniqueKeys.has(key)) {
      uniqueKeys.add(key);
      uniqueJobs.push(prepareUnique(srcUrl, Math.round(wIn * dpi), Math.round(hIn * dpi), it.rotation ?? 0, it.flipped, it.assetId));
    }
  }
  const LOAD_BATCH = 16;
  for (let i = 0; i < uniqueJobs.length; i += LOAD_BATCH) {
    await Promise.all(uniqueJobs.slice(i, i + LOAD_BATCH));
  }

  // Phase 2 — build preparedItems from cache (instant — no I/O).
  type PreparedItem = { it: (typeof normalizedItems)[number]; data: Buffer; info: { width: number; height: number } };
  const preparedItems: PreparedItem[] = [];
  for (const it of itemsToLoad) {
    const wIn = Math.max(0, Number(it.widthIn || 0));
    const hIn = Math.max(0, Number(it.heightIn || 0));
    if (!(wIn > 0) || !(hIn > 0)) continue;
    const srcUrl = resolveUrl(it);
    if (!srcUrl) continue;
    const cached = await prepareUnique(srcUrl, Math.round(wIn * dpi), Math.round(hIn * dpi), it.rotation ?? 0, it.flipped, it.assetId);
    if (!cached) continue;
    preparedItems.push({ it, data: cached.data, info: cached.info });
  }

  // Lay out placements; stop at cap so preview never OOMs.
  for (const { it, data, info } of preparedItems) {
    if (placements.length >= compositesCap) break;
    const copies = it.copies;
    const wIn = it.widthIn;
    const hIn = it.heightIn;
    const capacityCols = Math.max(1, Math.floor((effectiveWidthIn + gapIn) / Math.max(1e-6, wIn + gapIn)));
    const cols = Math.max(1, Math.min(copies, capacityCols));

    for (let idx = 0; idx < copies; idx++) {
      if (placements.length >= compositesCap) break;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const xIn = Number(it.posX || 0) + col * (wIn + gapIn);
      const yIn = Number(it.posY || 0) + row * (hIn + gapIn);

      const cropLeftIn = crop ? crop.leftIn : 0;
      const cropTopIn = crop ? crop.topIn : 0;
      const centerXpx = Math.round((xIn - cropLeftIn + wIn / 2) * dpi);
      const centerYpx = Math.round((yIn - cropTopIn + hIn / 2) * dpi);

      placements.push({
        data,
        srcW: info.width,
        srcH: info.height,
        left: Math.round(centerXpx - info.width / 2),
        top: Math.round(centerYpx - info.height / 2),
      });
    }
  }

  // Fast pure-JS raw RGBA blit — bypasses Sharp's per-composite overhead entirely.
  // For the common case of N copies of the same image, Sharp's chunked composite call
  // had per-op pipeline cost; this is row-by-row Buffer.copy when source pixels are
  // opaque (the common print case), falling back to source-over only when needed.
  const accumulator = Buffer.alloc(widthPx * heightPx * 4);

  for (const p of placements) {
    const sx0 = Math.max(0, -p.left);
    const sy0 = Math.max(0, -p.top);
    const dx0 = Math.max(0, p.left);
    const dy0 = Math.max(0, p.top);
    const w = Math.min(p.srcW - sx0, widthPx - dx0);
    const h = Math.min(p.srcH - sy0, heightPx - dy0);
    if (w <= 0 || h <= 0) continue;

    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const srcRowStart = ((sy0 + y) * p.srcW + sx0) * 4;
      const dstRowStart = ((dy0 + y) * widthPx + dx0) * 4;

      // Fast path: if destination row at these pixels is fully transparent (alpha = 0),
      // we can memcpy the source row directly. This holds for non-overlapping tiles,
      // which is the normal gangsheet layout.
      let canFastCopy = true;
      for (let x = 3; x < rowBytes; x += 4) {
        if (accumulator[dstRowStart + x] !== 0) { canFastCopy = false; break; }
      }

      if (canFastCopy) {
        p.data.copy(accumulator, dstRowStart, srcRowStart, srcRowStart + rowBytes);
      } else {
        // Per-pixel source-over alpha blend for the rare overlap case.
        for (let x = 0; x < w; x++) {
          const si = srcRowStart + x * 4;
          const di = dstRowStart + x * 4;
          const sA = p.data[si + 3];
          if (sA === 0) continue;
          const dA = accumulator[di + 3];
          if (sA === 255 || dA === 0) {
            accumulator[di] = p.data[si];
            accumulator[di + 1] = p.data[si + 1];
            accumulator[di + 2] = p.data[si + 2];
            accumulator[di + 3] = sA;
            continue;
          }
          const oneMinusSA = 255 - sA;
          const outA = sA + ((dA * oneMinusSA) >> 8);
          accumulator[di] = ((p.data[si] * sA + ((accumulator[di] * dA * oneMinusSA) >> 8)) / outA) | 0;
          accumulator[di + 1] = ((p.data[si + 1] * sA + ((accumulator[di + 1] * dA * oneMinusSA) >> 8)) / outA) | 0;
          accumulator[di + 2] = ((p.data[si + 2] * sA + ((accumulator[di + 2] * dA * oneMinusSA) >> 8)) / outA) | 0;
          accumulator[di + 3] = outA;
        }
      }
    }
  }

  // Free all decoded source image buffers now — we've blitted everything into the
  // accumulator so the per-image RGBA buffers are no longer needed. Releasing them
  // before the Sharp encode step halves peak memory on large sheets.
  preparedItems.length = 0;
  bufCache.clear();

  // Suppress unused-base warning — we use the dimensions directly via Buffer.alloc above.
  void base;

  // Zero out RGB for fully-transparent pixels — prediction filters (Sub/Up/Paeth) compress
  // runs of zeros far better than non-zero RGB under alpha=0, cutting file size significantly.
  for (let i = 0; i < accumulator.length; i += 4) {
    if (accumulator[i + 3] === 0) {
      accumulator[i] = 0;
      accumulator[i + 1] = 0;
      accumulator[i + 2] = 0;
    }
  }

  const pipeline = sharp(accumulator, {
    raw: { width: widthPx, height: heightPx, channels: 4 },
    limitInputPixels: false,
  });

  // compressionLevel 1 = fastest lossless encoding; level 9 can take 10+ minutes on large
  // sheets and provides only marginal size savings vs 1 for RGBA print files.
  // icc string is intentionally omitted — Sharp treats it as a file path and throws ENOENT.
  // WebP uses lossless mode so the preview quality is identical to the PNG export —
  // lossy WebP at quality 85 produced visible compression blur on fine print details.
  const out = await (format === "webp"
    ? pipeline.webp({ lossless: true, effort: 6 }).withMetadata({ density: dpi })
    : pipeline.png({ compressionLevel: 1, adaptiveFiltering: false, palette: false, effort: 2, force: true }).withMetadata({ density: dpi })
  ).toFile(filePath);

  const errors: string[] = [];
  const meta = await sharp(filePath, { limitInputPixels: false }).metadata();

  // Only flag structural failures — format/dimension/alpha mismatches indicate a broken
  // file. DPI and colorspace metadata drift is a warning, not a fatal error.
  if (meta.format !== format) errors.push(`format_not_${format}`);
  if (meta.width !== widthPx || meta.height !== heightPx) errors.push("pixel_dimensions_mismatch");
  if (format === "png") {
    if (!meta.hasAlpha) errors.push("alpha_missing");
    if (meta.channels !== 4) errors.push("not_rgba");
  }
  for (const e of sourceResolutionErrors) errors.push(e);

  const validation = {
    ok: errors.length === 0,
    errors,
    meta: {
      width: meta.width,
      height: meta.height,
      channels: meta.channels,
      density: meta.density,
      space: meta.space,
      hasAlpha: meta.hasAlpha,
      size: out.size,
    },
  };

  return {
    fileName,
    filePath,
    relativePath,
    byteSize: out.size,
    dpi,
    sheet: { widthIn: outputSheetWidthIn, heightIn: outputSheetHeightIn },
    validation,
    cacheKey,
    cacheHit: false,
    crop,
  };
};
