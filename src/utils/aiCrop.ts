import sharp from "sharp";

/** The content's bounding box, in the source image's own pixels. */
export interface TrimBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The whole image, for telling "nothing to trim" apart from a real crop. */
  fullWidth: number;
  fullHeight: number;
  hasTransparency: boolean;
}

export const findTrimBox = async (input: Buffer | string): Promise<TrimBox | null> => {
  const meta = await sharp(input, { limitInputPixels: false }).metadata();
  const origW = meta.width || 0;
  const origH = meta.height || 0;

  if (!origW || !origH) return null;

  const maxProbe = 1200;
  const probe = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .resize({
      width: Math.min(origW, maxProbe),
      height: Math.min(origH, maxProbe),
      fit: "inside",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = probe.info.width;
  const h = probe.info.height;
  const buf = probe.data;

  // Check for ANY transparency in the probe
  let hasTransparency = false;
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] < 250) { hasTransparency = true; break; }
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  let found = false;

  if (hasTransparency) {
    const alphaThreshold = 10;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = buf[(y * w + x) * 4 + 3];
        if (a > alphaThreshold) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  } else {
    // Sample the full outer border strip (~2% of the shorter dimension)
    const borderW = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    let sumR = 0, sumG = 0, sumB = 0, count = 0;

    for (let y = 0; y < borderW; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        sumR += buf[i]; sumG += buf[i + 1]; sumB += buf[i + 2]; count++;
        const i2 = ((h - 1 - y) * w + x) * 4;
        sumR += buf[i2]; sumG += buf[i2 + 1]; sumB += buf[i2 + 2]; count++;
      }
    }
    for (let x = 0; x < borderW; x++) {
      for (let y = borderW; y < h - borderW; y++) {
        const i = (y * w + x) * 4;
        sumR += buf[i]; sumG += buf[i + 1]; sumB += buf[i + 2]; count++;
        const i2 = (y * w + (w - 1 - x)) * 4;
        sumR += buf[i2]; sumG += buf[i2 + 1]; sumB += buf[i2 + 2]; count++;
      }
    }

    const bgR = count > 0 ? sumR / count : 255;
    const bgG = count > 0 ? sumG / count : 255;
    const bgB = count > 0 ? sumB / count : 255;
    const colorThreshold = 30;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dr = buf[i] - bgR;
        const dg = buf[i + 1] - bgG;
        const db = buf[i + 2] - bgB;
        if (Math.sqrt(dr * dr + dg * dg + db * db) > colorThreshold) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  const whole: TrimBox = { left: 0, top: 0, width: origW, height: origH, fullWidth: origW, fullHeight: origH, hasTransparency };
  if (!found || maxX < minX || maxY < minY) return whole;

  // Scale probe coordinates back to original image resolution
  const scaleX = origW / w;
  const scaleY = origH / h;
  const left = Math.max(0, Math.floor(minX * scaleX));
  const top = Math.max(0, Math.floor(minY * scaleY));
  const right = Math.min(origW, Math.ceil((maxX + 1) * scaleX));
  const bottom = Math.min(origH, Math.ceil((maxY + 1) * scaleY));

  return {
    ...whole,
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
};

/** The trimmed image, or `unchanged` when there was nothing to trim. */
export type TrimResult =
  | { unchanged: true; widthPx: number; heightPx: number }
  | { unchanged: false; buffer: Buffer; widthPx: number; heightPx: number };

export const trimImage = async (input: Buffer): Promise<TrimResult | null> => {
  const box = await findTrimBox(input);
  if (!box) return null;
  if (box.left === 0 && box.top === 0 && box.width === box.fullWidth && box.height === box.fullHeight) {
    return { unchanged: true, widthPx: box.fullWidth, heightPx: box.fullHeight };
  }
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { unchanged: false, buffer: data, widthPx: info.width, heightPx: info.height };
};
