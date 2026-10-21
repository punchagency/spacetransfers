import fs from "fs";
import { isStoredArtworkUrl } from "./storage.service.js";
import path from "path";
import crypto from "node:crypto";
import sharp from "sharp";
import mongoose from "mongoose";
import { Asset } from "../models/asset.model.js";

/**
 * The roll width every order was built on before the width was recorded.
 *
 * Every artboard coordinate is absolute against the roll the sheet was laid out
 * on: render onto a canvas of any other width and every x-coordinate silently
 * means something else. The width is now an admin setting and each order records
 * its own (`rollWidthIn`); renders read it through `orderSheetWidthIn`, which
 * falls back to this for older orders.
 */
export const GANGSHEET_SHEET_WIDTH_IN = 23.5;

/**
 * The width a stored order's sheet was built, billed and must be printed on.
 *
 * The roll width is an admin setting, so it can change after an order is
 * placed. Positions are absolute against the width the customer laid the sheet
 * out on, which checkout records as `rollWidthIn`; every render uses exactly
 * that, so a later change to the setting cannot shift or clip a sheet already
 * ordered. Orders from before it was recorded were all built on 23.5in.
 */
export const orderSheetWidthIn = (item: { rollWidthIn?: unknown } | null | undefined): number => {
  const width = Number(item?.rollWidthIn);
  return Number.isFinite(width) && width > 0 ? width : GANGSHEET_SHEET_WIDTH_IN;
};

/**
 * Print resolution for a final export: 23.5in × 300 = 7,050px.
 *
 * The whole point of a fixed DPI is that physical size and pixel size stay
 * locked together, so a sheet's pixel width is a pure function of its inches.
 */
export const GANGSHEET_PRINT_DPI = 300;

const SHEET_DEFAULT_WIDTH_IN = GANGSHEET_SHEET_WIDTH_IN;
const SHEET_DEFAULT_HEIGHT_IN = 23.5;
export const GROUP_GAP_IN = 0.06;
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

  // Only artwork we stored: this address came from an order, which a customer wrote.
  if (isStoredArtworkUrl(url)) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20_000);
    try {
      const res = await fetch(url, { signal: ac.signal, redirect: "error" });
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
  nestRotation: number; flowCols: number | null;
}>): string => {
  const h = crypto.createHash("sha1");
  h.update(`n=${items.length};`);
  for (const it of items) {
    h.update(`${it.assetId}|${it.croppedUrl}|${it.widthIn}|${it.heightIn}|${it.posX}|${it.posY}|${it.rotation}|${it.flipped ? 1 : 0}|${it.copies}|${it.nestRotation}|${it.flowCols ?? ""};`);
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

export const computeRotatedBounds = (wIn: number, hIn: number, rotationDeg: number) => {
  const r = ((Number(rotationDeg) || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const w = Math.abs(wIn * c) + Math.abs(hIn * s);
  const h = Math.abs(wIn * s) + Math.abs(hIn * c);
  return { wIn: w, hIn: h };
};

/** What the artboard stores about one placement's geometry. */
export interface PlacementGeometryInput {
  widthIn: number;
  heightIn: number;
  rotation?: number;
  copies?: number;
  /** 90 when auto-nest turned the piece to fit it; see `resolvePlacement`. */
  nestRotation?: number | null;
  /** Columns auto-nest wrapped the copies into. */
  flowCols?: number | null;
}

export const resolvePlacement = (
  it: PlacementGeometryInput,
  effectiveWidthIn: number,
  gapIn: number,
) => {
  const widthIn = Math.max(0, Number(it.widthIn || 0));
  const heightIn = Math.max(0, Number(it.heightIn || 0));
  const copies = Math.max(1, Math.floor(Number(it.copies || 1)));
  const rotation = typeof it.rotation === "number" && Number.isFinite(it.rotation) ? it.rotation : 0;
  const nested = Number(it.nestRotation) === 90;

  const cellW = nested ? heightIn : widthIn;
  const cellH = nested ? widthIn : heightIn;
  const oddQuarter = ((Math.round(rotation / 90) % 2) + 2) % 2 === 1;
  const imageW = oddQuarter ? heightIn : widthIn;
  const imageH = oddQuarter ? widthIn : heightIn;
  const totalRotation = (((rotation + (nested ? 90 : 0)) % 360) + 360) % 360;

  const flowCols = Number(it.flowCols);
  const cols =
    Number.isFinite(flowCols) && flowCols >= 1
      ? Math.min(copies, Math.floor(flowCols))
      : Math.max(1, Math.min(copies, Math.floor((effectiveWidthIn + gapIn) / Math.max(1e-6, cellW + gapIn))));

  return { cellW, cellH, imageW, imageH, totalRotation, copies, cols };
};

interface PlacedCopyBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlacementParams {
  sheetWidthIn: number;
  artboardItems: Array<PlacementGeometryInput & { posX: number; posY: number }>;
  itemSpacingIn?: number | null;
  sheetMarginIn?: number | null;
}

/**
 * Walks every copy the renderer will actually draw, in sheet inches.
 *
 * Extracted from `computeContentBoundsIn` so the crop bounds and the export
 * cut lines are derived from one implementation of the layout. Copies wrap
 * into columns, rotation changes an item's footprint, and the gap comes from
 * the sheet's own spacing setting — reproducing that arithmetic a second time
 * for the splitter is exactly how a cut line ends up landing somewhere the
 * renderer did not put an edge, which is how a graphic gets sliced in half.
 */
const forEachPlacedCopy = (
  { sheetWidthIn, artboardItems, itemSpacingIn, sheetMarginIn }: PlacementParams,
  visit: (box: PlacedCopyBox) => void,
): void => {
  const gapIn = typeof itemSpacingIn === "number" && itemSpacingIn >= 0 ? itemSpacingIn : GROUP_GAP_IN;
  const marginIn = typeof sheetMarginIn === "number" && sheetMarginIn >= 0 ? sheetMarginIn : 0;
  const effectiveWidthIn = sheetWidthIn - 2 * marginIn;

  for (const it of artboardItems) {
    const p = resolvePlacement(it, effectiveWidthIn, gapIn);
    if (!(p.cellW > 0) || !(p.cellH > 0)) continue;

    // A quarter turn fills the cell exactly; any other angle is bounded as drawn.
    const drawn = computeRotatedBounds(p.imageW, p.imageH, p.totalRotation);

    for (let idx = 0; idx < p.copies; idx++) {
      const col = idx % p.cols;
      const row = Math.floor(idx / p.cols);
      const cx = Number(it.posX || 0) + col * (p.cellW + gapIn) + p.cellW / 2;
      const cy = Number(it.posY || 0) + row * (p.cellH + gapIn) + p.cellH / 2;

      visit({
        left: cx - drawn.wIn / 2,
        top: cy - drawn.hIn / 2,
        right: cx + drawn.wIn / 2,
        bottom: cy + drawn.hIn / 2,
      });
    }
  }
};

/** Vertical extent of every drawn copy, in sheet inches. */
export const computeItemVerticalSpansIn = (
  params: PlacementParams,
): Array<{ topIn: number; bottomIn: number }> => {
  const spans: Array<{ topIn: number; bottomIn: number }> = [];
  forEachPlacedCopy(params, ({ top, bottom }) => {
    spans.push({ topIn: top, bottomIn: bottom });
  });
  return spans;
};

/**
 * How long this sheet prints, in inches: the bottom of its lowest graphic.
 *
 * A sheet is billed on its length, so the billed length has to be at least
 * this. Checkout sends the length it measured on the artboard; the order keeps
 * the longer of the two, so no sheet is charged for less than it prints.
 */
/**
 * How far across the roll the artwork reaches, in inches: the right edge of its
 * rightmost graphic (and the left edge of its leftmost, which must not be
 * negative). Anything past the roll width cannot be printed — it is cut off.
 */
export const printedSheetExtentIn = (params: PlacementParams): { left: number; right: number } => {
  let left = Infinity;
  let right = 0;
  forEachPlacedCopy(params, (box) => {
    if (box.left < left) left = box.left;
    if (box.right > right) right = box.right;
  });
  return { left: Number.isFinite(left) ? left : 0, right };
};

export const printedSheetLengthIn = (params: PlacementParams): number => {
  let bottom = 0;
  forEachPlacedCopy(params, (box) => {
    if (box.bottom > bottom) bottom = box.bottom;
  });
  return bottom;
};

/**
 * How long the print file is, in inches: down to the bottom of the lowest
 * graphic, plus the sheet margin below it. A sheet billed at the minimum length
 * is not padded out to it — the partner prints the artwork, not the blank film.
 * A sheet with nothing placed keeps its recorded length.
 */
export const printFileLengthIn = (params: PlacementParams, recordedLengthIn: number): number => {
  const contentIn = printedSheetLengthIn(params);
  if (!(contentIn > 0)) return recordedLengthIn;
  const marginIn =
    typeof params.sheetMarginIn === "number" && params.sheetMarginIn >= 0 ? params.sheetMarginIn : 0;
  return Math.round((contentIn + marginIn) * 1000) / 1000;
};

/** The size of the print file for one stored order sheet: its roll width by `printFileLengthIn`. */
export const orderSheetPrintFileIn = (item: Record<string, any>): { widthIn: number; heightIn: number } => {
  const widthIn = orderSheetWidthIn(item);
  const recorded = [item?.sheetHeightIn, item?.heightIn].find((v) => typeof v === "number" && Number.isFinite(v));
  return {
    widthIn,
    heightIn: printFileLengthIn(
      {
        sheetWidthIn: widthIn,
        artboardItems: Array.isArray(item?.artboardItems) ? item.artboardItems : [],
        itemSpacingIn: typeof item?.itemSpacingIn === "number" ? item.itemSpacingIn : undefined,
        sheetMarginIn: typeof item?.sheetMarginIn === "number" ? item.sheetMarginIn : undefined,
      },
      typeof recorded === "number" ? recorded : GANGSHEET_SHEET_WIDTH_IN,
    ),
  };
};

/**
 * Segments a gang sheet into printable lengths that never bisect a graphic.
 *
 * `targetLengthIn` is a target, not a clipping boundary. A cut is proposed at
 * every multiple of it; if any graphic straddles that line the cut moves down
 * to the far edge of the straddling graphic, so the piece is emitted whole in
 * the earlier segment rather than appearing cropped in one part and again in
 * the next. Moving the line can bring it inside a further graphic, so the
 * search repeats until the line is clear — bounded by the span count, since
 * every pass clears at least one span.
 *
 * Segments are returned back-to-back (`endIn` of one is `startIn` of the next)
 * so the parts reassemble into exactly the original sheet: no row is emitted
 * twice and none is dropped.
 */
export const computeGangsheetCuts = ({
  totalHeightIn,
  spans,
  targetLengthIn,
}: {
  totalHeightIn: number;
  spans: Array<{ topIn: number; bottomIn: number }>;
  targetLengthIn: number;
}): Array<{ startIn: number; endIn: number }> => {
  const eps = 1e-6;
  const cuts: Array<{ startIn: number; endIn: number }> = [];
  if (!(totalHeightIn > 0) || !(targetLengthIn > 0)) return cuts;

  let start = 0;
  // Bounded independently of the extension loop: each segment consumes at
  // least one target length or ends the sheet, so this cannot spin.
  for (let segment = 0; segment < 10_000 && start < totalHeightIn - eps; segment++) {
    let end = Math.min(start + targetLengthIn, totalHeightIn);

    for (let guard = 0; guard <= spans.length; guard++) {
      if (end >= totalHeightIn - eps) break;
      let pushedTo = end;
      for (const s of spans) {
        // Straddling means the line falls strictly inside the graphic. A
        // graphic that merely ends on the line is already whole above it.
        if (s.topIn < end - eps && s.bottomIn > end + eps && s.bottomIn > pushedTo) {
          pushedTo = s.bottomIn;
        }
      }
      if (pushedTo <= end + eps) break;
      end = Math.min(pushedTo, totalHeightIn);
    }

    end = Math.min(end, totalHeightIn);
    if (end <= start + eps) break;
    cuts.push({ startIn: start, endIn: end });
    start = end;
  }

  return cuts;
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
  artboardItems: PlacementParams["artboardItems"];
  itemSpacingIn?: number | null;
  sheetMarginIn?: number | null;
}) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  forEachPlacedCopy(
    { sheetWidthIn, artboardItems, itemSpacingIn, sheetMarginIn },
    ({ left, top, right, bottom }) => {
      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    },
  );

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
  useLossyPreview = false,
  itemSpacingIn,
  sheetMarginIn,
  renderWindowIn,
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
    nestRotation?: number | null;
    flowCols?: number | null;
  }>;
  dpi: number;
  cropToContent?: boolean;
  /** Preview-mode cap: stop adding composites after this many. Omit for full export. */
  maxComposites?: number;
  /** Output format. 'webp' for browser previews (5-10x smaller); 'png' (default) for DTF print export. */
  format?: "png" | "webp";
  /** Use lossy WebP for faster encoding and smaller file size (for previews only) */
  useLossyPreview?: boolean;
  /** Inter-copy gap in inches — must match the artboard spacing setting. Defaults to GROUP_GAP_IN if omitted. */
  itemSpacingIn?: number | null;
  /** Left/right margin in inches — must match the artboard margin setting. Defaults to 0 if omitted. */
  sheetMarginIn?: number | null;
  /**
   * Render only this window of the sheet, in sheet inches.
   *
   * Exists so a sheet longer than one canvas can be produced at full print
   * resolution: the splitter renders each cut as its own window rather than
   * rendering the whole roll into one buffer and slicing the result, which is
   * what forced the DPI cap (and with it the pixel width) down on long sheets.
   *
   * It is the same mechanism `cropToContent` already used — an origin offset
   * plus a smaller canvas — supplied rather than computed, so placement,
   * ordering and clipping all go through the one existing code path. Wins over
   * `cropToContent` when both are given.
   */
  renderWindowIn?: { leftIn: number; topIn: number; widthIn: number; heightIn: number } | null;
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
  return await _doExport({ jobId, printerId, sheetWidthIn, sheetHeightIn, artboardItems, dpi: dpiInput, cropToContent, maxComposites, format, useLossyPreview, itemSpacingIn, sheetMarginIn, renderWindowIn });
  } finally {
    releaseRenderSlot();
  }
};

/**
 * Physical inches → print pixels. The only conversion in the pipeline.
 *
 * `23.5in × 300dpi = 7050px`, and every other dimension follows the same rule,
 * so physical size and pixel size can never drift apart.
 */
export const toPrintPixels = (inches: number, dpi: number): number =>
  Math.max(1, Math.round(inches * dpi));

/** RGBA ceiling for one canvas. Above this the render cannot be allocated. */
const MAX_BUFFER_BYTES = 2 * 1024 * 1024 * 1024;
/** WebP cannot encode a dimension beyond this, whatever the buffer allows. */
const MAX_WEBP_DIM = 16383;

export const resolveRenderDpi = ({
  widthIn,
  heightIn,
  requestedDpi,
  format = "png",
}: {
  widthIn: number;
  heightIn: number;
  requestedDpi: number;
  format?: "png" | "webp";
}): number => {
  const areaSqIn = widthIn * heightIn;
  const maxFromBuffer =
    areaSqIn > 0 ? Math.floor(Math.sqrt(MAX_BUFFER_BYTES / 4 / areaSqIn)) : requestedDpi;

  if (format === "webp") {
    const maxFromWidth = Math.floor(MAX_WEBP_DIM / Math.max(1e-6, widthIn));
    const maxFromHeight = Math.floor(MAX_WEBP_DIM / Math.max(1e-6, heightIn));
    return Math.max(10, Math.min(requestedDpi, maxFromWidth, maxFromHeight, maxFromBuffer));
  }
  return Math.max(10, Math.min(requestedDpi, maxFromBuffer));
};

const _doExport = async ({
  jobId, printerId, sheetWidthIn, sheetHeightIn, artboardItems, dpi: dpiInput,
  cropToContent = false, maxComposites, format = "png", useLossyPreview = false,
  itemSpacingIn, sheetMarginIn, renderWindowIn,
}: {
  jobId: string; printerId: string; sheetWidthIn?: number | null; sheetHeightIn?: number | null;
  artboardItems: Array<{ assetId: string; croppedUrl?: string; widthIn: number; heightIn: number;
    posX: number; posY: number; rotation?: number; flipped?: boolean; copies?: number;
    nestRotation?: number | null; flowCols?: number | null }>;
  dpi: number; cropToContent?: boolean; maxComposites?: number; format?: "png" | "webp";
  useLossyPreview?: boolean;
  itemSpacingIn?: number | null; sheetMarginIn?: number | null;
  renderWindowIn?: { leftIn: number; topIn: number; widthIn: number; heightIn: number } | null;
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
      nestRotation: Number(it.nestRotation) === 90 ? 90 : 0,
      flowCols:
        Number.isFinite(Number(it.flowCols)) && Number(it.flowCols) >= 1
          ? Math.floor(Number(it.flowCols))
          : null,
    }))
    .sort((a, b) => {
      if (a.assetId !== b.assetId) return a.assetId.localeCompare(b.assetId);
      if (a.croppedUrl !== b.croppedUrl) return a.croppedUrl.localeCompare(b.croppedUrl);
      if (a.posX !== b.posX) return a.posX - b.posX;
      if (a.posY !== b.posY) return a.posY - b.posY;
      if (a.widthIn !== b.widthIn) return a.widthIn - b.widthIn;
      if (a.heightIn !== b.heightIn) return a.heightIn - b.heightIn;
      if (a.rotation !== b.rotation) return a.rotation - b.rotation;
      if (a.nestRotation !== b.nestRotation) return a.nestRotation - b.nestRotation;
      if ((a.flowCols ?? 0) !== (b.flowCols ?? 0)) return (a.flowCols ?? 0) - (b.flowCols ?? 0);
      return a.copies - b.copies;
    });

  // An explicit window is an instruction about which part of the sheet to draw;
  // `cropToContent` is a request to work that out from the artwork. When both
  // arrive the caller has already decided, so the window wins.
  const crop = renderWindowIn
    ? renderWindowIn
    : cropToContent
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

  const dpi = resolveRenderDpi({
    widthIn: outputSheetWidthIn,
    heightIn: outputSheetHeightIn,
    requestedDpi: rawDpi,
    format,
  });
  if (dpi < rawDpi) {
    console.warn(`[gangsheet] capped DPI ${rawDpi}→${dpi} for ${outputSheetWidthIn.toFixed(1)}"×${outputSheetHeightIn.toFixed(1)}" canvas — render it as bands to keep full resolution`);
  }

  const widthPx = toPrintPixels(outputSheetWidthIn, dpi);
  const heightPx = toPrintPixels(outputSheetHeightIn, dpi);

  // Cap items used for the cache key to maxComposites so we never stringify 10k+ items.
  const capForKey = typeof maxComposites === "number" && maxComposites > 0 ? maxComposites : normalizedItems.length;
  const itemsHash = computeItemsHash(normalizedItems.slice(0, capForKey));
  const cacheKey = computeCacheKey({
    // 11: placements honour nestRotation, flowCols and a rotated piece's
    // pre-swapped size. Every earlier cached render drew those wrongly.
    v: 11,
    jobId,
    printerId,
    dpi,
    sheet: { widthIn, heightIn },
    cropToContent,
    crop,
    itemsHash,
    png: format === "webp"
      ? { format: "webp", lossless: !useLossyPreview }
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
    const p = resolvePlacement(it, effectiveWidthIn, gapIn);
    if (!(p.cellW > 0) || !(p.cellH > 0)) continue;
    const srcUrl = resolveUrl(it);
    if (!srcUrl) continue;
    // Sized to the image's own upright shape, then turned — see resolvePlacement.
    const wPx = Math.round(p.imageW * dpi);
    const hPx = Math.round(p.imageH * dpi);
    const key = `${srcUrl}|${wPx}|${hPx}|${p.totalRotation}|${it.flipped ? 1 : 0}`;
    if (!uniqueKeys.has(key)) {
      uniqueKeys.add(key);
      uniqueJobs.push(prepareUnique(srcUrl, wPx, hPx, p.totalRotation, it.flipped, it.assetId));
    }
  }
  const LOAD_BATCH = 16;
  for (let i = 0; i < uniqueJobs.length; i += LOAD_BATCH) {
    await Promise.all(uniqueJobs.slice(i, i + LOAD_BATCH));
  }

  // Phase 2 — build preparedItems from cache (instant — no I/O).
  type PreparedItem = {
    it: (typeof normalizedItems)[number];
    p: ReturnType<typeof resolvePlacement>;
    data: Buffer;
    info: { width: number; height: number };
  };
  const preparedItems: PreparedItem[] = [];
  for (const it of itemsToLoad) {
    const p = resolvePlacement(it, effectiveWidthIn, gapIn);
    if (!(p.cellW > 0) || !(p.cellH > 0)) continue;
    const srcUrl = resolveUrl(it);
    if (!srcUrl) continue;
    const cached = await prepareUnique(srcUrl, Math.round(p.imageW * dpi), Math.round(p.imageH * dpi), p.totalRotation, it.flipped, it.assetId);
    if (!cached) continue;
    preparedItems.push({ it, p, data: cached.data, info: cached.info });
  }

  // Lay out placements; stop at cap so preview never OOMs.
  for (const { it, p, data, info } of preparedItems) {
    if (placements.length >= compositesCap) break;

    for (let idx = 0; idx < p.copies; idx++) {
      if (placements.length >= compositesCap) break;
      const col = idx % p.cols;
      const row = Math.floor(idx / p.cols);
      const xIn = Number(it.posX || 0) + col * (p.cellW + gapIn);
      const yIn = Number(it.posY || 0) + row * (p.cellH + gapIn);

      const cropLeftIn = crop ? crop.leftIn : 0;
      const cropTopIn = crop ? crop.topIn : 0;
      const centerXpx = Math.round((xIn - cropLeftIn + p.cellW / 2) * dpi);
      const centerYpx = Math.round((yIn - cropTopIn + p.cellH / 2) * dpi);

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
  // WebP uses lossless mode for exports, lossy mode for previews
  const out = await (format === "webp"
    ? (useLossyPreview 
      ? pipeline.webp({ quality: 85, effort: 4 }).withMetadata({ density: dpi }) // Fast lossy for previews
      : pipeline.webp({ lossless: true, effort: 6 }).withMetadata({ density: dpi }) // Lossless for exports
    )
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
