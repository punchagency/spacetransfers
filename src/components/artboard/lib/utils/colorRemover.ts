/**
 * Colour removal and replacement.
 *
 * Runs entirely in the browser on a canvas, which is the right call rather than
 * a limitation: "remove this exact colour" is a deterministic pixel operation
 * with an unambiguous correct answer, so handing it to a generative model would
 * be slower, cost a quota credit, and — worst — return an *approximation* of
 * the artwork with the colour mostly gone. For transfer printing, where a
 * removed colour usually means a background that has to be genuinely absent,
 * "mostly" is a reprint.
 *
 * Three things make the difference between this and a naive RGB threshold:
 *
 *  - **Perceptual distance.** Matching in RGB treats a 30-unit shift in green
 *    as the same as 30 in blue, which the eye does not. Distances are measured
 *    in CIE L*a*b* instead, so one tolerance value behaves consistently whether
 *    the user picked a pale sky or a deep navy.
 *  - **Soft edges.** A binary keep/drop decision produces the jagged, aliased
 *    outline that makes a cutout look cheap, and on a transfer it shows as a
 *    hard fringe. Alpha ramps across a band near the tolerance boundary, so
 *    anti-aliased edges and soft shadows fall off smoothly.
 *  - **Spill suppression.** Pixels that partially matched keep a tint of the
 *    removed colour — the classic green-screen halo. Their residual is scaled
 *    back in proportion to how much they matched.
 */

export interface RemoveColorOptions {
  /** Hex colour to remove, e.g. "#ffffff". */
  targetColor: string;
  /** Hex colour to substitute, or null/undefined for transparency. */
  replacementColor?: string | null;
  /**
   * 0–100, where 0 removes only exact matches and 100 removes nearly
   * everything. Mapped onto a perceptual distance below.
   */
  tolerance?: number;
  /** Report progress for the shared AI progress bar. */
  onProgress?: (phase: string, pct: number) => void;
}

export interface RemoveColorResult {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** Fraction of pixels fully or partly removed, 0–1. Surfaced so the UI can
   *  warn when a pick did nothing rather than silently returning the original. */
  affectedRatio: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const parseHexColor = (hex: string): Rgb | null => {
  const cleaned = hex.trim().replace(/^#/, "");
  const expanded =
    cleaned.length === 3 || cleaned.length === 4
      ? cleaned
          .slice(0, 3)
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  const value = parseInt(expanded, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

/* ---------------------------------------------------------------- *
 * sRGB → CIE L*a*b*
 *
 * Via linear RGB and XYZ under a D65 white point. Written out rather than
 * pulled from a colour library because it is the only conversion needed and
 * this file is on the hot path for every pixel of a print-resolution image.
 * ---------------------------------------------------------------- */

const linearize = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

// D65 reference white, scaled to Y = 100.
const WHITE_X = 95.047;
const WHITE_Y = 100.0;
const WHITE_Z = 108.883;

const pivot = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

interface Lab {
  l: number;
  a: number;
  b: number;
}

const rgbToLab = ({ r, g, b }: Rgb): Lab => {
  const rl = linearize(r);
  const gl = linearize(g);
  const bl = linearize(b);

  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) * 100;
  const y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) * 100;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) * 100;

  const fx = pivot(x / WHITE_X);
  const fy = pivot(y / WHITE_Y);
  const fz = pivot(z / WHITE_Z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
};

const labDistance = (a: Lab, b: Lab): number =>
  Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);

/**
 * Tolerance → perceptual radius.
 *
 * A ΔE of ~2.3 is the just-noticeable difference, and ~100 spans black to
 * white, so the usable range is small at the bottom and needs resolution
 * there. The curve is quadratic for that reason: the low half of the slider
 * covers the fine distinctions people actually adjust between (a flat colour
 * with JPEG noise around it), while the top end still reaches far enough to
 * take out a whole colour family in one pass.
 */
const toleranceToRadius = (tolerance: number): number => {
  const t = Math.max(0, Math.min(100, tolerance)) / 100;
  return 2 + t * t * 88;
};

/**
 * Width of the alpha ramp, as a fraction of the match radius.
 *
 * This is what turns a hard key into a clean edge. Pixels closer than
 * `radius * (1 - FEATHER)` are removed outright; beyond `radius` they are kept
 * untouched; in between, alpha falls off smoothly. A proportional band rather
 * than a fixed ΔE so a tight pick stays tight and a broad one still feathers.
 */
const FEATHER = 0.35;

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    // Required to read pixels back out of the canvas for a remote asset —
    // without it the canvas is tainted and getImageData throws.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image"));
    img.src = url;
  });

/**
 * Samples the colour at a normalised point in an image, for the eyedropper.
 * `x`/`y` are 0–1 so the caller can pass a click position without knowing the
 * image's pixel size or how it was scaled for display.
 *
 * Averages a small neighbourhood rather than reading a single pixel: artwork
 * that has been through JPEG compression has per-pixel noise, and a lone
 * outlier pixel makes the picked colour miss the flat region around it.
 */
export const sampleColorAt = async (
  imageUrl: string,
  x: number,
  y: number,
  radiusPx = 2,
): Promise<string> => {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable in this browser");
  ctx.drawImage(image, 0, 0);

  const cx = Math.round(Math.max(0, Math.min(1, x)) * (canvas.width - 1));
  const cy = Math.round(Math.max(0, Math.min(1, y)) * (canvas.height - 1));
  const x0 = Math.max(0, cx - radiusPx);
  const y0 = Math.max(0, cy - radiusPx);
  const w = Math.min(canvas.width - x0, radiusPx * 2 + 1);
  const h = Math.min(canvas.height - y0, radiusPx * 2 + 1);

  const { data } = ctx.getImageData(x0, y0, w, h);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Transparent pixels carry no meaningful colour — including them would
    // drag the average toward whatever happens to be in the unused channels.
    if (data[i + 3] < 8) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return "#000000";

  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
};

/**
 * Removes (or replaces) every occurrence of a colour.
 *
 * Yields to the event loop between row bands so a print-resolution image — tens
 * of millions of pixels — cannot lock the main thread. Without that, a 6000px
 * artwork freezes the UI for seconds and the progress bar it is meant to be
 * driving never paints a single frame.
 */
export const removeColor = async (
  imageUrl: string,
  options: RemoveColorOptions,
): Promise<RemoveColorResult> => {
  const { targetColor, replacementColor, tolerance = 25, onProgress } = options;

  const target = parseHexColor(targetColor);
  if (!target) throw new Error(`“${targetColor}” isn't a colour I can read.`);
  const replacement = replacementColor ? parseHexColor(replacementColor) : null;
  if (replacementColor && !replacement) {
    throw new Error(`“${replacementColor}” isn't a colour I can read.`);
  }

  onProgress?.("Loading image…", 5);
  const image = await loadImage(imageUrl);

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable in this browser");
  ctx.drawImage(image, 0, 0);

  onProgress?.("Matching colour…", 15);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const targetLab = rgbToLab(target);
  const radius = toleranceToRadius(tolerance);
  const innerRadius = radius * (1 - FEATHER);
  let affected = 0;

  /**
   * Memoises the match strength per distinct RGB triple.
   *
   * The Lab conversion is the expensive part of the loop, and artwork is
   * overwhelmingly repeated colours — a logo on a flat background may hold a
   * few thousand distinct values across millions of pixels. Caching by packed
   * RGB turns a per-pixel cost into a per-colour one, which is what makes this
   * viable at print resolution.
   */
  const strengthCache = new Map<number, number>();
  const matchStrength = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    const cached = strengthCache.get(key);
    if (cached !== undefined) return cached;

    const distance = labDistance(rgbToLab({ r, g, b }), targetLab);
    // 1 = fully this colour, 0 = unrelated, in between = on the feather band.
    const strength =
      distance <= innerRadius
        ? 1
        : distance >= radius
        ? 0
        : 1 - (distance - innerRadius) / (radius - innerRadius);
    strengthCache.set(key, strength);
    return strength;
  };

  // ~250k pixels per slice: large enough that the yield overhead is negligible,
  // small enough to stay well inside a frame budget on a mid-range machine.
  const rowsPerSlice = Math.max(1, Math.floor(250_000 / Math.max(1, width)));

  for (let yStart = 0; yStart < height; yStart += rowsPerSlice) {
    const yEnd = Math.min(height, yStart + rowsPerSlice);

    for (let y = yStart; y < yEnd; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const alpha = data[i + 3];
        // Already transparent — nothing to remove, and its RGB is meaningless.
        if (alpha === 0) continue;

        const strength = matchStrength(data[i], data[i + 1], data[i + 2]);
        if (strength === 0) continue;
        affected++;

        if (replacement) {
          // Substitution: cross-fade toward the new colour by match strength so
          // anti-aliased edges blend instead of stepping.
          data[i] = Math.round(data[i] + (replacement.r - data[i]) * strength);
          data[i + 1] = Math.round(data[i + 1] + (replacement.g - data[i + 1]) * strength);
          data[i + 2] = Math.round(data[i + 2] + (replacement.b - data[i + 2]) * strength);
          continue;
        }

        // Removal: scale alpha down by how much this pixel matched.
        data[i + 3] = Math.round(alpha * (1 - strength));

        // Spill suppression. A partially-matched pixel still carries a tint of
        // the colour being removed, which is what leaves a coloured halo around
        // a cutout. Pull its channels away from the target in proportion to the
        // match so the surviving fringe reads neutral.
        if (strength > 0 && strength < 1 && data[i + 3] > 0) {
          data[i] = Math.round(data[i] - (target.r - data[i]) * strength * 0.5);
          data[i + 1] = Math.round(data[i + 1] - (target.g - data[i + 1]) * strength * 0.5);
          data[i + 2] = Math.round(data[i + 2] - (target.b - data[i + 2]) * strength * 0.5);
        }
      }
    }

    onProgress?.("Removing colour…", 15 + Math.round((yEnd / height) * 75));
    // Hand the frame back so the progress bar can actually paint.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  ctx.putImageData(imageData, 0, 0);
  onProgress?.("Finishing…", 96);

  return {
    // PNG unconditionally: a removal produces an alpha channel, and JPEG would
    // silently composite it onto black.
    dataUrl: canvas.toDataURL("image/png"),
    widthPx: width,
    heightPx: height,
    affectedRatio: affected / Math.max(1, width * height),
  };
};

/**
 * Every distinct colour in an image, ordered by how much of it there is.
 *
 * Feeds the swatch row in the panel, so removing a background is a single click
 * on a real colour from the artwork rather than a guess at a hex value.
 *
 * Colours are bucketed to a coarse grid before counting. Counting exact values
 * would return thousands of near-identical entries from JPEG noise and
 * gradients, and the top of that list is dominated by imperceptible variants of
 * one colour — useless as a set of choices.
 */
export const extractDominantColors = async (
  imageUrl: string,
  count = 6,
): Promise<Array<{ hex: string; ratio: number }>> => {
  const image = await loadImage(imageUrl);

  // Sampled at low resolution. Dominance is a statistical question and a
  // 200px thumbnail answers it identically to the full file, in a fraction of
  // the time — this runs on every panel open.
  const scale = Math.min(1, 200 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let counted = 0;

  // 24 levels per channel ≈ a ΔE of a few units per bucket: fine enough to keep
  // two genuinely different colours apart, coarse enough to collapse noise.
  const STEP = 24;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    const key =
      (Math.round(data[i] / STEP) << 16) |
      (Math.round(data[i + 1] / STEP) << 8) |
      Math.round(data[i + 2] / STEP);
    const bucket = buckets.get(key);
    if (bucket) {
      // Accumulate the true values so the swatch shown is a real colour from
      // the artwork, not the centre of an arbitrary bucket.
      bucket.r += data[i];
      bucket.g += data[i + 1];
      bucket.b += data[i + 2];
      bucket.n++;
    } else {
      buckets.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], n: 1 });
    }
    counted++;
  }
  if (counted === 0) return [];

  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((bucket) => ({
      hex: `#${hex(bucket.r / bucket.n)}${hex(bucket.g / bucket.n)}${hex(bucket.b / bucket.n)}`,
      ratio: bucket.n / counted,
    }));
};
