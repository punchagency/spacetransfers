import sharp from "sharp";
import {
  geminiPlanningReady,
  generateJsonWithGemini,
} from "./gemini.service.js";

/**
 * Fade detection for DTF printing.
 *
 * DTF lays down a white underbase that is effectively binary — ink is either
 * deposited or it is not. Artwork that ramps into transparency therefore cannot
 * be reproduced: the fade prints as a hard, ragged edge. Catching that before
 * it reaches a press is the whole point of this check.
 *
 * The difficulty is that a fade looks, to a naive alpha test, exactly like three
 * things that are perfectly printable:
 *
 *  - **Anti-aliasing.** Every cutout PNG has a 1–2px band of partial alpha
 *    around its silhouette. On a small or detailed logo that band is easily 5%
 *    of the visible pixels.
 *  - **Drop shadows.** Uniformly semi-transparent by design. They do print, but
 *    solid, not at the opacity shown — so they are flagged by the measured
 *    see-through rule (`seeThroughVerdict`), not called fades.
 *  - **Soft glows and feathered edges.**
 *
 * The previous rule was `semiTransparent / visible > 0.05`, which cannot tell
 * any of these apart from a real fade — it flagged ordinary cutouts and shadows,
 * and it missed nothing only because it flagged almost everything.
 *
 * This module replaces it with two layers. A geometric analysis extracts signals
 * that actually discriminate (see `analyzeAlpha`), and those signals plus two
 * rendered views of the image go to a vision model for the final judgement. The
 * analysis is not merely a fallback: it is what makes the model's job tractable,
 * because it supplies the alpha channel — which the model otherwise cannot see
 * at all.
 */

/** Analysis resolution. Fades are large-scale structure; 256px resolves them. */
const ANALYSIS_PX = 256;

/** Alpha at or below this is transparent; at or above `OPAQUE_AT`, opaque. */
const TRANSPARENT_AT = 8;
const OPAQUE_AT = 248;

/**
 * Alpha below this is more than 50% transparent.
 *
 * DTF prints each pixel solid or not at all, so no partial transparency comes
 * out as it looks on screen. Two bands are told apart because the outcome
 * differs: more than 50% transparent does not print as shown at all; less than
 * that prints fully solid, stronger than on screen.
 */
export const FAINT_BELOW = 128;

/**
 * Share of the visible artwork that must be see-through (any alpha between
 * `TRANSPARENT_AT` and `OPAQUE_AT`, edges excluded) before the image is flagged.
 * Low enough to catch a small shadow or overlay, and high enough to ignore a
 * few stray pixels.
 */
export const SEE_THROUGH_FLAG_RATIO = 0.01;

/**
 * Resolution for the see-through measurement. It is sampled with
 * nearest-neighbour, never averaged: averaging turns a halftone's solid dots
 * (the printable way to make a fade) into an even grey that would read as
 * see-through.
 */
const SEE_THROUGH_ANALYSIS_PX = 1024;

/**
 * Bumped whenever the rules change, so a verdict cached on an asset under older
 * rules is recomputed rather than trusted.
 */
export const TRANSPARENCY_CHECK_VERSION = 3;

export type FadeVerdictSource = "ai" | "heuristic";

export type FadeKind =
  | "fade"
  | "semi-transparent"
  | "translucent"
  | "anti-aliasing"
  | "shadow"
  | "soft-edge"
  | "opaque"
  | "none";

export interface FadeAnalysis {
  /** Fraction of the frame that is visible at all. */
  visibleRatio: number;
  /** Partially transparent pixels, as a fraction of visible ones. */
  semiRatio: number;
  /**
   * Partially transparent pixels that are *not* on the silhouette boundary,
   * as a fraction of visible ones.
   *
   * The single most discriminating signal here. Anti-aliasing is a thin band
   * whose neighbourhood always contains both a fully opaque and a fully
   * transparent pixel; a genuine fade has broad regions where everything nearby
   * is also partial. Shadows share that property, which is why this alone is
   * not the verdict.
   */
  interiorSemiRatio: number;
  /**
   * Longest monotonic alpha ramp found, as a fraction of the image's size.
   *
   * A fade is a *sustained* directional gradient. Anti-aliasing ramps over one
   * or two pixels; a shadow's falloff is short and radial. A run covering a
   * meaningful fraction of the width or height is the signature of a real fade.
   */
  maxRampRatio: number;
  /** Distinct alpha levels present — a hard cutout has very few. */
  alphaLevels: number;
  /**
   * Pixels more than 50% transparent that are not an anti-aliased edge, as a
   * fraction of visible ones. See `seeThroughShares`.
   */
  faintRatio: number;
  /** Pixels partly transparent but at least 50% opaque, edges excluded, as a fraction of visible ones. */
  translucentRatio: number;
}

export interface FadeResult {
  /** True when the image has transparency DTF cannot print as shown: a fade, or see-through areas. */
  hasFade: boolean;
  /** 0–1. How sure the check is, whichever layer produced it. */
  confidence: number;
  kind: FadeKind;
  /** One sentence a customer can act on. */
  reason: string;
  /** Which layer produced this verdict. */
  source: FadeVerdictSource;
  analysis: FadeAnalysis;
  /** `TRANSPARENCY_CHECK_VERSION` at the time this verdict was reached. */
  version: number;
}

/**
 * Shares of the visible artwork that are see-through, not counting anti-aliased
 * edges: `faint` (more than 50% transparent) and `translucent` (partly
 * transparent, at least 50% opaque).
 *
 * `alpha` is one byte per pixel. A pixel counts when its alpha is above
 * `TRANSPARENT_AT` (it is there at all) and below `OPAQUE_AT`, and its 5×5
 * neighbourhood does not hold both a fully opaque and a fully transparent pixel.
 * That second test is what excludes the 1–2px soft edge every cutout has: an
 * edge pixel always sits between solid artwork and empty space.
 */
export const seeThroughShares = (
  alpha: Uint8Array | Buffer,
  w: number,
  h: number,
): { faint: number; translucent: number } => {
  const at = (x: number, y: number) => alpha[y * w + x];
  let visible = 0;
  let faint = 0;
  let translucent = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = at(x, y);
      if (a <= TRANSPARENT_AT) continue;
      visible++;
      if (a >= OPAQUE_AT) continue;

      let sawOpaque = false;
      let sawTransparent = false;
      for (let dy = -2; dy <= 2 && !(sawOpaque && sawTransparent); dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            sawTransparent = true;
            continue;
          }
          const n = at(nx, ny);
          if (n >= OPAQUE_AT) sawOpaque = true;
          else if (n <= TRANSPARENT_AT) sawTransparent = true;
          if (sawOpaque && sawTransparent) break;
        }
      }
      if (sawOpaque && sawTransparent) continue;
      if (a < FAINT_BELOW) faint++;
      else translucent++;
    }
  }

  const total = Math.max(1, visible);
  return { faint: faint / total, translucent: translucent / total };
};

const measureSeeThrough = async (buffer: Buffer) => {
  const { data, info } = await sharp(buffer, { limitInputPixels: false })
    .ensureAlpha()
    .resize(SEE_THROUGH_ANALYSIS_PX, SEE_THROUGH_ANALYSIS_PX, {
      fit: "inside",
      withoutEnlargement: true,
      kernel: "nearest",
    })
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return seeThroughShares(data, info.width, info.height);
};

/**
 * Extracts alpha-channel geometry.
 *
 * Runs on a downscaled copy: a fade is large-scale structure, so full print
 * resolution buys nothing and costs a great deal — this runs on every upload.
 */
export const analyzeAlpha = async (buffer: Buffer): Promise<FadeAnalysis> => {
  const image = sharp(buffer, { limitInputPixels: false }).ensureAlpha();
  const resized = image.resize(ANALYSIS_PX, ANALYSIS_PX, {
    fit: "inside",
    withoutEnlargement: true,
  });

  const { data, info } = await resized
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const at = (x: number, y: number) => data[y * w + x];

  let visible = 0;
  let semi = 0;
  let interiorSemi = 0;
  const levels = new Set<number>();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = at(x, y);
      // Quantised: JPEG-ish noise and dithering otherwise report hundreds of
      // "levels" for what is visually a two-tone cutout.
      levels.add(a >> 4);
      if (a <= TRANSPARENT_AT) continue;
      visible++;
      if (a >= OPAQUE_AT) continue;
      semi++;

      // Boundary test. A 5×5 neighbourhood is wide enough to span a 2px
      // anti-aliased edge; if it contains both extremes, this pixel is part of
      // that transition rather than part of a broad partial region.
      let sawOpaque = false;
      let sawTransparent = false;
      for (let dy = -2; dy <= 2 && !(sawOpaque && sawTransparent); dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          // Off-frame counts as transparent: artwork running to the edge of its
          // canvas is bounded there, and treating it as unknown would classify
          // a legitimate edge fade as interior.
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            sawTransparent = true;
            continue;
          }
          const n = at(nx, ny);
          if (n >= OPAQUE_AT) sawOpaque = true;
          else if (n <= TRANSPARENT_AT) sawTransparent = true;
          if (sawOpaque && sawTransparent) break;
        }
      }
      if (!(sawOpaque && sawTransparent)) interiorSemi++;
    }
  }

  return {
    visibleRatio: visible / Math.max(1, w * h),
    semiRatio: semi / Math.max(1, visible),
    interiorSemiRatio: interiorSemi / Math.max(1, visible),
    maxRampRatio: longestRamp(data, w, h),
    alphaLevels: levels.size,
    ...(await measureSeeThrough(buffer).then(({ faint, translucent }) => ({
      faintRatio: faint,
      translucentRatio: translucent,
    }))),
  };
};

/**
 * Longest smooth alpha gradient, scanning rows and columns.
 *
 * The measure is *gradient smoothness*, not total alpha change over a span, and
 * the distinction is the whole point. A drop shadow's alpha profile is a step
 * function: flat at zero, one abrupt jump, flat at the shadow's opacity, one
 * abrupt drop. Measured as "how far does alpha travel over a contiguous
 * stretch" that scores as highly as a real fade — an earlier version of this
 * did exactly that and classified a uniform shadow as a fade.
 *
 * What actually separates them is how the change is *distributed*. A fade
 * changes a little at every pixel across a long distance; a step changes
 * everything at one pixel and nothing elsewhere. So this counts the longest run
 * of consecutive **gentle, same-direction** steps:
 *
 *  - a step of 0 is a plateau — tolerated briefly, since a shallow fade
 *    quantises to repeated values, but a long flat stretch ends the run;
 *  - a step above `MAX_GENTLE_STEP` is a hard edge (an anti-aliased boundary is
 *    a single ~127 jump), which ends the run;
 *  - a reversal ends the run, so a symmetric falloff is not read as one ramp.
 *
 * Returned relative to the longest side, so it is comparable across sizes.
 */
const longestRamp = (data: Buffer | Uint8Array, w: number, h: number): number => {
  /** Above this, a step is an edge rather than part of a gradient. */
  const MAX_GENTLE_STEP = 32;
  /** Consecutive unchanged pixels tolerated inside a ramp. */
  const MAX_PLATEAU = 3;

  let best = 0;

  const scan = (length: number, read: (i: number) => number) => {
    let runLength = 0;
    let plateau = 0;
    let direction = 0;
    let previous = read(0);

    const endRun = () => {
      runLength = 0;
      plateau = 0;
      direction = 0;
    };

    for (let i = 1; i < length; i++) {
      const current = read(i);
      const delta = current - previous;
      previous = current;

      const magnitude = Math.abs(delta);

      if (magnitude === 0) {
        // A plateau extends the run only briefly. Without the cap, the long
        // flat interior of a shadow would keep a run alive indefinitely.
        if (direction === 0) continue;
        plateau++;
        if (plateau > MAX_PLATEAU) endRun();
        else runLength++;
        continue;
      }

      if (magnitude > MAX_GENTLE_STEP) {
        // A hard edge. Not part of any gradient, and it starts nothing.
        endRun();
        continue;
      }

      const nextDirection = Math.sign(delta);
      if (direction !== 0 && nextDirection !== direction) {
        // Reversal — this is a new run, starting here.
        runLength = 1;
      } else {
        runLength++;
      }
      direction = nextDirection;
      plateau = 0;

      if (runLength > best) best = runLength;
    }
  };

  for (let y = 0; y < h; y++) scan(w, (x) => data[y * w + x]);
  for (let x = 0; x < w; x++) scan(h, (y) => data[y * w + x]);

  return best / Math.max(1, Math.max(w, h));
};

/**
 * Verdict from geometry alone.
 *
 * Used when the vision model is unavailable, and sent to the model as prior
 * evidence when it is. Thresholds are deliberately conservative on the
 * false-positive side: telling someone their clean cutout cannot be printed
 * costs them a pointless re-export and erodes trust in the warning, which is
 * worse than the occasional missed fade that a human proof would catch.
 */
export const heuristicVerdict = (analysis: FadeAnalysis): Omit<FadeResult, "source" | "analysis" | "version"> => {
  const { interiorSemiRatio, maxRampRatio, semiRatio, alphaLevels } = analysis;

  // Essentially no partial alpha: a hard-edged cutout or a fully opaque image.
  if (semiRatio < 0.005) {
    return {
      hasFade: false,
      confidence: 0.95,
      kind: alphaLevels <= 2 ? "opaque" : "none",
      reason: "No partial transparency beyond hard edges.",
    };
  }

  // Partial alpha exists but only in a thin boundary band — anti-aliasing.
  if (interiorSemiRatio < 0.01) {
    return {
      hasFade: false,
      confidence: 0.9,
      kind: "anti-aliasing",
      reason: "Partial transparency is confined to anti-aliased edges, which print normally.",
    };
  }

  // Broad partial regions AND a sustained gradient — the fade signature.
  if (interiorSemiRatio > 0.02 && maxRampRatio > 0.08) {
    const confidence = Math.min(0.9, 0.55 + interiorSemiRatio * 2 + maxRampRatio);
    return {
      hasFade: true,
      confidence,
      kind: "fade",
      reason: "A sustained gradient into transparency was found, which DTF cannot reproduce.",
    };
  }

  // Broad partial regions without a sustained ramp — a shadow or soft glow.
  return {
    hasFade: false,
    confidence: 0.6,
    kind: interiorSemiRatio > 0.05 ? "shadow" : "soft-edge",
    reason: "Semi-transparent areas look like a shadow or soft edge rather than a fade.",
  };
};

/**
 * Verdict for see-through artwork over a real area.
 *
 * Measured, not judged, so it is final: nothing the model says can make partial
 * transparency print as it looks. Null when the see-through area is below the
 * flag ratio.
 */
export const seeThroughVerdict = (
  analysis: FadeAnalysis,
): Omit<FadeResult, "source" | "analysis" | "version"> | null => {
  const seeThrough = analysis.faintRatio + analysis.translucentRatio;
  if (seeThrough < SEE_THROUGH_FLAG_RATIO) return null;
  const percent = (ratio: number) => Math.max(1, Math.round(ratio * 100));

  if (heuristicVerdict(analysis).hasFade) {
    return {
      hasFade: true,
      confidence: 1,
      kind: "fade",
      reason: `It fades into transparency; about ${percent(seeThrough)}% of the artwork is see-through.`,
    };
  }
  if (analysis.faintRatio >= SEE_THROUGH_FLAG_RATIO) {
    return {
      hasFade: true,
      confidence: 1,
      kind: "semi-transparent",
      reason: `About ${percent(analysis.faintRatio)}% of the artwork is more than 50% transparent.`,
    };
  }
  return {
    hasFade: true,
    confidence: 1,
    kind: "translucent",
    reason: `About ${percent(seeThrough)}% of the artwork is partly transparent.`,
  };
};

/* ------------------------------------------------------------------ *
 * AI classification
 * ------------------------------------------------------------------ */

/**
 * The two views sent to the model.
 *
 * A vision model cannot see an alpha channel. Handed a PNG, it receives whatever
 * the decoder composited it onto, so a fade to transparency and a fade to white
 * are literally the same picture to it — and the second is printable. Both views
 * are therefore rendered explicitly:
 *
 *  - **Alpha map:** the alpha channel as greyscale, white opaque and black
 *    transparent. This makes the distinction unambiguous, and the three
 *    confusable cases look completely different here: anti-aliasing is a hairline
 *    outline, a shadow is a detached soft blob, a fade is a broad smooth ramp.
 *  - **Checkerboard composite:** the artwork over a checkerboard, the way a
 *    designer inspects transparency. This gives the model the subject matter, so
 *    it can tell a deliberate faded design element from an accident.
 */
const buildInspectionViews = async (
  buffer: Buffer,
): Promise<{ alphaMap: Buffer; composite: Buffer }> => {
  const VIEW_PX = 512;

  const base = sharp(buffer, { limitInputPixels: false })
    .ensureAlpha()
    .resize(VIEW_PX, VIEW_PX, { fit: "inside", withoutEnlargement: true });

  const alphaMap = await base.clone().extractChannel(3).png().toBuffer();

  const { data, info } = await base
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Checkerboard generated at the composite's own size so the squares stay a
  // consistent visual size regardless of the artwork's aspect ratio.
  const SQUARE = 16;
  const checker = Buffer.alloc(info.width * info.height * 3);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const light = (Math.floor(x / SQUARE) + Math.floor(y / SQUARE)) % 2 === 0;
      const value = light ? 235 : 190;
      const i = (y * info.width + x) * 3;
      checker[i] = checker[i + 1] = checker[i + 2] = value;
    }
  }

  const composite = await sharp(checker, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .composite([
      {
        input: data,
        raw: { width: info.width, height: info.height, channels: info.channels as 4 },
      },
    ])
    .png()
    .toBuffer();

  return { alphaMap, composite };
};

const FADE_SYSTEM = `You inspect artwork destined for DTF (direct-to-film) transfer printing and decide whether it contains a genuine fade into transparency.

Why this matters: DTF prints a white underbase that is effectively binary — ink is either laid down or it is not. Artwork that ramps into transparency cannot be reproduced and prints as a hard, ragged edge. Artwork that is merely soft-edged, shadowed or anti-aliased prints correctly.

You receive two views of the SAME artwork:
1. ALPHA MAP — the alpha channel as greyscale. White = fully opaque, black = fully transparent, grey = partially transparent. Judge transparency from THIS image.
2. CHECKERBOARD COMPOSITE — the artwork over a checkerboard, for subject matter and context.

Classify as exactly one "kind":
- "fade": a broad, sustained gradient from opaque into transparency. In the alpha map this is a large smooth grey ramp. THIS IS THE ONLY CASE THAT SHOULD SET hasFade TRUE.
- "anti-aliasing": partial alpha only in a hairline (1-2px) outline tracing the subject's silhouette. Normal and printable.
- "shadow": a soft, usually detached or offset semi-transparent region shaped like a cast shadow or glow. Printable.
- "soft-edge": a deliberately feathered or blurred edge that does not extend far into the subject. Printable.
- "opaque": no meaningful partial transparency at all.

Critical distinctions:
- A gradient in COLOUR or BRIGHTNESS is not a fade. Only transparency counts. If the alpha map is uniformly white, hasFade is false no matter what the composite looks like.
- A fade to a solid background colour is printable. Only a fade to TRANSPARENCY is a problem.
- Lighting, glows, reflections and blurs that stay opaque are not fades.
- Anti-aliasing always exists on cutout artwork. Never report it as a fade.

Set hasFade true ONLY for "fade". Give "confidence" as your genuine certainty 0-1. Write "reason" as one short sentence a customer can act on. Return ONLY JSON.`;

const FADE_SCHEMA = {
  type: "object",
  properties: {
    hasFade: { type: "boolean" },
    confidence: { type: "number" },
    kind: {
      type: "string",
      enum: ["fade", "anti-aliasing", "shadow", "soft-edge", "opaque", "none"],
    },
    reason: { type: "string" },
  },
  required: ["hasFade", "confidence", "kind", "reason"],
} as const;

/**
 * Asks the vision model to classify the image.
 *
 * Returns null when the model is unavailable or answers unusably, so the caller
 * degrades to geometry rather than failing an upload over an optional check.
 */
export const classifyFadeWithAi = async (
  buffer: Buffer,
  analysis: FadeAnalysis,
): Promise<Omit<FadeResult, "source" | "analysis" | "version"> | null> => {
  if (!geminiPlanningReady()) return null;

  try {
    const { alphaMap, composite } = await buildInspectionViews(buffer);

    // The measured geometry travels with the images. It is evidence the model
    // cannot derive by looking — it has no way to measure a ramp's length in
    // pixels — and it anchors borderline cases that would otherwise come down
    // to the model's impression of a blurry grey region.
    const evidence = [
      `Measured alpha geometry (computed from the real alpha channel):`,
      `- visible area: ${(analysis.visibleRatio * 100).toFixed(1)}% of frame`,
      `- partially transparent pixels: ${(analysis.semiRatio * 100).toFixed(1)}% of visible`,
      `- partial pixels NOT on the silhouette edge: ${(analysis.interiorSemiRatio * 100).toFixed(1)}% of visible (high values mean broad partial regions, not anti-aliasing)`,
      `- longest sustained alpha gradient: ${(analysis.maxRampRatio * 100).toFixed(1)}% of the image's longest side (a real fade is typically above 8%)`,
      `- distinct alpha levels: ${analysis.alphaLevels}`,
    ].join("\n");

    const parsed = await generateJsonWithGemini({
      system: FADE_SYSTEM,
      schema: FADE_SCHEMA,
      parts: [
        { text: "ALPHA MAP (white = opaque, black = transparent):" },
        { inlineData: { mimeType: "image/png", data: alphaMap.toString("base64") } },
        { text: "CHECKERBOARD COMPOSITE (artwork over a checkerboard):" },
        { inlineData: { mimeType: "image/png", data: composite.toString("base64") } },
        { text: evidence },
      ],
    });

    if (!parsed || typeof parsed.hasFade !== "boolean") return null;

    const kind: FadeKind = (
      ["fade", "anti-aliasing", "shadow", "soft-edge", "opaque", "none"] as FadeKind[]
    ).includes(parsed.kind)
      ? parsed.kind
      : parsed.hasFade
      ? "fade"
      : "none";

    return {
      hasFade: parsed.hasFade,
      // Clamped: a model asked for a probability will occasionally return 1.2
      // or a percentage, and an out-of-range confidence corrupts every
      // threshold downstream.
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      kind,
      reason: String(parsed.reason || "").trim() || "Analysed by the fade checker.",
    };
  } catch (error: any) {
    console.warn(`[FADE] AI classification failed (${error?.message}) — using geometry`);
    return null;
  }
};

export const detectFade = async (buffer: Buffer): Promise<FadeResult> => {
  let analysis: FadeAnalysis;
  try {
    analysis = await analyzeAlpha(buffer);
  } catch (error: any) {
    // No readable alpha channel at all (a JPEG, or an unsupported format).
    // Nothing can fade into transparency without one, so this is a clean "no".
    console.warn(`[FADE] alpha analysis failed (${error?.message})`);
    return {
      hasFade: false,
      confidence: 0.5,
      kind: "opaque",
      reason: "This image has no transparency, so it cannot contain a fade.",
      source: "heuristic",
      analysis: {
        visibleRatio: 1,
        semiRatio: 0,
        interiorSemiRatio: 0,
        maxRampRatio: 0,
        alphaLevels: 1,
        faintRatio: 0,
        translucentRatio: 0,
      },
      version: TRANSPARENCY_CHECK_VERSION,
    };
  }

  const version = TRANSPARENCY_CHECK_VERSION;

  const seeThrough = seeThroughVerdict(analysis);
  if (seeThrough) return { ...seeThrough, source: "heuristic", analysis, version };

  /**
   * Short-circuit before spending a model call.
   *
   * An image with essentially no partial alpha cannot contain a fade — that is
   * arithmetic, not judgement, and the model can only agree or be wrong. Since
   * most uploads are in this state, skipping them is what keeps the AI path
   * affordable and fast enough to be the default.
   */
  if (analysis.semiRatio < 0.005) {
    return { ...heuristicVerdict(analysis), source: "heuristic", analysis, version };
  }

  const ai = await classifyFadeWithAi(buffer, analysis);
  if (ai) return { ...ai, source: "ai", analysis, version };

  return { ...heuristicVerdict(analysis), source: "heuristic", analysis, version };
};
