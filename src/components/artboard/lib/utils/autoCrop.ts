/**
 * Auto-crop: find the artwork's tight bounding box and cut to it.
 *
 * Extracted from `useDropHandler` and rewritten, because the original version
 * was the single largest source of main-thread stall on a bulk drop and the
 * direct cause of the "artboard freezes on 100+ images" report.
 *
 * The original ran, per file, at full native resolution:
 *   - `getImageData` over the whole image (a 4000×4000 PNG allocates a 64 MB
 *     Uint8ClampedArray),
 *   - one full pixel loop to test for any transparency,
 *   - a second full pixel loop to find the bounding box,
 *   - and a synchronous `toDataURL` PNG encode.
 *
 * All of that is synchronous, so `await cropImage(...)` yielded nothing: six
 * pool workers each entered this and the main thread was pinned for the whole
 * drop. Nothing rendered, no input was serviced — the "freeze".
 *
 * Two changes remove it:
 *
 *  1. **Analyse small, cut big.** The bounding box is found on a copy scaled
 *     down to at most `ANALYSIS_MAX_EDGE` on its long edge — a 16 Mpx image
 *     becomes ~1 Mpx, a 16× reduction in both allocation and loop count. The
 *     box is then scaled back to native coordinates and padded by the scale
 *     factor so the downscale can never clip real artwork. The actual crop is
 *     still taken from the full-resolution source, so exported pixels are
 *     unchanged.
 *
 *  2. **Yield between phases.** Even the reduced scan is given back to the
 *     event loop before the encode, so React can paint committed items and the
 *     browser can service input while a large batch is in flight.
 */

/**
 * Long-edge ceiling for the bounding-box scan.
 *
 * 1024 keeps the analysis under ~1 Mpx for any input while leaving the box
 * accurate to within a couple of native pixels on a 4K source — and the result
 * is padded by exactly the scale factor, so the error can only ever make the
 * crop slightly generous, never clip artwork.
 */
const ANALYSIS_MAX_EDGE = 1024;

/** Alpha at or below this is treated as fully transparent. */
const ALPHA_FLOOR = 10;

/** Any alpha below this anywhere means the image has a real alpha channel. */
const ALPHA_OPAQUE = 250;

/** Euclidean RGB distance from the sampled background that counts as content. */
const COLOR_THRESHOLD = 30;

export interface CropResult {
  url: string;
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
}

/** Hands the main thread back so React can paint and input stays responsive. */
const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Decodes to something drawable without blocking on the main thread.
 *
 * `createImageBitmap` decodes off-thread and is the fast path. It is not
 * universally available for every source, so a plain `Image` remains as a
 * fallback — that one decodes on the main thread, but only for browsers that
 * would have done so anyway.
 */
const decode = async (url: string): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === "function") {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return await createImageBitmap(blob);
    } catch {
      // Fall through — a cross-origin URL without CORS, or a source the
      // bitmap decoder rejects, is still usually loadable as an <img>.
    }
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
};

const sizeOf = (source: ImageBitmap | HTMLImageElement) => ({
  width: "naturalWidth" in source ? source.naturalWidth : source.width,
  height: "naturalHeight" in source ? source.naturalHeight : source.height,
});

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box of the artwork within `data`, in that buffer's own coordinates.
 *
 * Returns null when the image is uniformly background — there is no meaningful
 * crop, and the caller keeps the image at its original size rather than
 * cutting it to nothing.
 */
const findBounds = (data: Uint8ClampedArray, w: number, h: number): Bounds | null => {
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < ALPHA_OPAQUE) {
      hasAlpha = true;
      break;
    }
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let found = false;

  if (hasAlpha) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > ALPHA_FLOOR) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  } else {
    // No alpha channel: infer the background from the border strip and treat
    // anything far enough from it as content.
    const borderW = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;

    for (let y = 0; y < borderW; y++) {
      for (let x = 0; x < w; x++) {
        let i = (y * w + x) * 4;
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count++;
        i = ((h - 1 - y) * w + x) * 4;
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count++;
      }
    }
    for (let x = 0; x < borderW; x++) {
      for (let y = borderW; y < h - borderW; y++) {
        let i = (y * w + x) * 4;
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count++;
        i = (y * w + (w - 1 - x)) * 4;
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count++;
      }
    }

    const bgR = count > 0 ? sumR / count : 255;
    const bgG = count > 0 ? sumG / count : 255;
    const bgB = count > 0 ? sumB / count : 255;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dr = data[i] - bgR;
        const dg = data[i + 1] - bgG;
        const db = data[i + 2] - bgB;
        if (Math.sqrt(dr * dr + dg * dg + db * db) > COLOR_THRESHOLD) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  if (!found || maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
};

/**
 * Crops `url` to its artwork bounds and returns a native-resolution PNG.
 *
 * Resolves null when there is nothing to crop (uniform image, decode failure,
 * or no 2D context) — every caller treats null as "keep the image as it
 * arrived", so a failure here degrades to the uncropped original rather than
 * failing the file.
 */
export const autoCropImage = async (
  url: string,
  dpi: number,
): Promise<CropResult | null> => {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(url);
  } catch {
    return null;
  }

  try {
    const { width: nativeW, height: nativeH } = sizeOf(source);
    if (!nativeW || !nativeH) return null;

    // Scan a reduced copy. `scale` is <= 1; at 1 the analysis is native-res
    // and the padding below collapses to zero, so small images are unaffected.
    const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(nativeW, nativeH));
    const scanW = Math.max(1, Math.round(nativeW * scale));
    const scanH = Math.max(1, Math.round(nativeH * scale));

    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = scanW;
    scanCanvas.height = scanH;
    const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
    if (!scanCtx) return null;
    scanCtx.drawImage(source as CanvasImageSource, 0, 0, scanW, scanH);

    const bounds = findBounds(
      scanCtx.getImageData(0, 0, scanW, scanH).data,
      scanW,
      scanH,
    );
    // Release the scan buffer before the encode allocates the output canvas.
    scanCanvas.width = 0;
    scanCanvas.height = 0;
    if (!bounds) return null;

    await yieldToBrowser();

    /**
     * Back to native coordinates, padded by one analysis pixel on each side.
     *
     * A box found at 1/4 scale is accurate to within 4 native pixels, and the
     * padding is exactly that scale factor — so the crop is at worst a few
     * pixels generous. Erring outward matters: a box that clipped inward
     * would shave real artwork off the print.
     */
    const pad = Math.ceil(1 / scale);
    const left = Math.max(0, Math.floor(bounds.minX / scale) - pad);
    const top = Math.max(0, Math.floor(bounds.minY / scale) - pad);
    const right = Math.min(nativeW - 1, Math.ceil(bounds.maxX / scale) + pad);
    const bottom = Math.min(nativeH - 1, Math.ceil(bounds.maxY / scale) + pad);

    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    if (cropWidth <= 0 || cropHeight <= 0) return null;

    // Nothing was trimmed — skip the re-encode entirely and let the caller
    // keep the original URL. Re-encoding here would spend a full PNG compress
    // to produce a byte-identical image under a different (and much larger)
    // data URL, which is exactly the payload bloat the asset pipeline exists
    // to avoid.
    if (cropWidth === nativeW && cropHeight === nativeH) return null;

    const out = document.createElement("canvas");
    out.width = cropWidth;
    out.height = cropHeight;
    const outCtx = out.getContext("2d");
    if (!outCtx) return null;
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = "high";
    // 1:1 pixel copy from the full-resolution source — no scaling either way.
    outCtx.drawImage(
      source as CanvasImageSource,
      left,
      top,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );

    const result: CropResult = {
      url: out.toDataURL("image/png"),
      widthPx: cropWidth,
      heightPx: cropHeight,
      widthIn: cropWidth / dpi,
      heightIn: cropHeight / dpi,
    };

    out.width = 0;
    out.height = 0;
    return result;
  } finally {
    // An ImageBitmap holds decoded pixels outside the JS heap and is not
    // reclaimed by GC on any predictable schedule. Across a 120-file drop
    // that is the difference between a flat memory profile and an OOM.
    if ("close" in source && typeof source.close === "function") source.close();
  }
};
