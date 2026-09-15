import { postAssetRef } from "../../../../lib/utils/payloadImages";

/**
 * Transparency checking for the artboard.
 *
 * DTF lays a white underbase that is effectively binary — ink is either
 * deposited or it is not — so no partial transparency prints as it looks:
 *
 *  - a **fade** into transparency prints as a hard, ragged edge;
 *  - areas **more than 50% transparent** do not come out as shown at all;
 *  - areas **partly transparent** (at least 50% opaque) print fully solid,
 *    stronger than on screen.
 *
 * The verdict comes from the server by default: see-through areas are measured, and
 * fades go to its AI checker, which sees the alpha channel rendered as a
 * greyscale map alongside a checkerboard composite. Anti-aliased edges and
 * halftone dots, which print normally, are excluded from both.
 *
 * The local check here is the fallback for when the server is unreachable. It
 * applies the same measurements as the server's geometry layer
 * (`fadeDetection.service.ts`), so a verdict reached without the network agrees
 * with one reached through it.
 */

export type FadeKind =
  | "fade"
  | "semi-transparent"
  | "translucent"
  | "anti-aliasing"
  | "shadow"
  | "soft-edge"
  | "opaque"
  | "none";

const FADE_KINDS: FadeKind[] = [
  "fade",
  "semi-transparent",
  "translucent",
  "anti-aliasing",
  "shadow",
  "soft-edge",
  "opaque",
  "none",
];

export interface FadeVerdict {
  /** True when the image has transparency DTF cannot print as shown: a fade, or see-through areas. */
  hasFade: boolean;
  /** 0–1. */
  confidence: number;
  kind: FadeKind;
  /** One sentence a customer can act on. */
  reason: string;
  source: "ai" | "heuristic";
}

/**
 * Below this the verdict is treated as inconclusive and the image is not
 * flagged.
 *
 * Asymmetric on purpose. A false positive tells someone their perfectly good
 * artwork cannot be printed — they re-export it, nothing changes, and they stop
 * believing the warning, which costs more than the occasional missed fade that
 * a proof would catch anyway. So a fade has to be asserted with real confidence
 * before it interrupts anyone. See-through areas are measured and always clear it.
 */
export const FADE_CONFIDENCE_THRESHOLD = 0.6;

/** Whether a verdict should actually raise a warning in the UI. */
export const shouldWarn = (verdict: FadeVerdict | undefined | null): boolean =>
  Boolean(verdict?.hasFade && verdict.confidence >= FADE_CONFIDENCE_THRESHOLD);

/** Normalises a server payload, tolerating partial or malformed responses. */
export const parseFadeVerdict = (raw: any): FadeVerdict | null => {
  if (!raw || typeof raw.hasFade !== "boolean") return null;
  const confidence = Number(raw.confidence);
  return {
    hasFade: raw.hasFade,
    // An out-of-range or missing confidence must not silently become a
    // high-confidence verdict; 0.5 sits below the warning threshold, so an
    // unparseable answer fails safe rather than raising a false alarm.
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    kind: FADE_KINDS.includes(raw.kind) ? raw.kind : raw.hasFade ? "fade" : "none",
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "",
    source: raw.source === "ai" ? "ai" : "heuristic",
  };
};

/**
 * What a flagged image tells the customer: a short title, and a body that says
 * what is wrong, why it matters, and what to do about it.
 *
 * One builder for the hover card, the native tooltip and the banner, so the
 * three never describe the same image differently.
 */
export const transparencyMessage = (verdict: FadeVerdict) => {
  const reason = verdict.reason ? `${verdict.reason} ` : "";
  const replace = "or replace it with a different file.";
  if (verdict.kind === "translucent") {
    return {
      title: "Partly transparent",
      body: `${reason}DTF can't print partial transparency, so these areas will print solid, stronger than they look on screen. Update the file to make those areas solid, ${replace}`,
    };
  }
  if (verdict.kind === "semi-transparent") {
    return {
      title: "Too transparent to print",
      body: `${reason}DTF can't print areas more than 50% transparent, so this won't print as it looks. Update the file to make those areas solid, ${replace}`,
    };
  }
  return {
    title: "Fade detected",
    body: `${reason}DTF can't print fades into transparency, so this won't print as it looks. Update the file to remove the fade, ${replace}`,
  };
};

/* ------------------------------------------------------------------ *
 * Measurements — mirrors of fadeDetection.service.ts
 * ------------------------------------------------------------------ */

const ANALYSIS_PX = 256;
const TRANSPARENT_AT = 8;
const OPAQUE_AT = 248;

/** Alpha below this is more than 50% transparent. */
export const FAINT_BELOW = 128;

/** Share of the visible artwork that must be see-through (edges excluded) to flag. */
export const SEE_THROUGH_FLAG_RATIO = 0.01;

/**
 * Resolution for the see-through measurement, sampled nearest-neighbour:
 * averaging turns a halftone's solid dots into an even grey that would read as
 * see-through.
 */
const SEE_THROUGH_ANALYSIS_PX = 1024;

/** Whether a partial pixel sits between solid artwork and empty space (an anti-aliased edge). */
const isEdge = (alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, x: number, y: number) => {
  let sawOpaque = false;
  let sawTransparent = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        sawTransparent = true;
      } else {
        const n = alpha[ny * w + nx];
        if (n >= OPAQUE_AT) sawOpaque = true;
        else if (n <= TRANSPARENT_AT) sawTransparent = true;
      }
      if (sawOpaque && sawTransparent) return true;
    }
  }
  return false;
};

/**
 * Shares of the visible artwork that are see-through, not counting anti-aliased
 * edges: `faint` (more than 50% transparent) and `translucent` (partly
 * transparent, at least 50% opaque). `alpha` is one byte per pixel.
 */
export const seeThroughShares = (
  alpha: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
): { faint: number; translucent: number } => {
  let visible = 0;
  let faint = 0;
  let translucent = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      if (a <= TRANSPARENT_AT) continue;
      visible++;
      if (a >= OPAQUE_AT || isEdge(alpha, w, h, x, y)) continue;
      if (a < FAINT_BELOW) faint++;
      else translucent++;
    }
  }
  const total = Math.max(1, visible);
  return { faint: faint / total, translucent: translucent / total };
};

/** Longest smooth, same-direction alpha gradient, relative to the longest side. */
const longestRamp = (alpha: Uint8ClampedArray | Uint8Array, w: number, h: number): number => {
  const MAX_GENTLE_STEP = 32;
  const MAX_PLATEAU = 3;
  let best = 0;

  const scan = (length: number, read: (i: number) => number) => {
    let runLength = 0;
    let plateau = 0;
    let direction = 0;
    let previous = read(0);
    for (let i = 1; i < length; i++) {
      const current = read(i);
      const delta = current - previous;
      previous = current;
      const magnitude = Math.abs(delta);
      if (magnitude === 0) {
        if (direction === 0) continue;
        plateau++;
        if (plateau > MAX_PLATEAU) {
          runLength = 0;
          plateau = 0;
          direction = 0;
        } else {
          runLength++;
        }
        continue;
      }
      if (magnitude > MAX_GENTLE_STEP) {
        runLength = 0;
        plateau = 0;
        direction = 0;
        continue;
      }
      const nextDirection = Math.sign(delta);
      runLength = direction !== 0 && nextDirection !== direction ? 1 : runLength + 1;
      direction = nextDirection;
      plateau = 0;
      if (runLength > best) best = runLength;
    }
  };

  for (let y = 0; y < h; y++) scan(w, (x) => alpha[y * w + x]);
  for (let x = 0; x < w; x++) scan(h, (y) => alpha[y * w + x]);
  return best / Math.max(1, Math.max(w, h));
};

export interface AlphaMeasurements {
  semiRatio: number;
  interiorSemiRatio: number;
  maxRampRatio: number;
  faintRatio: number;
  translucentRatio: number;
}

/**
 * The verdict from measurements alone — the same rules, in the same order, as
 * the server's `faintVerdict` and `heuristicVerdict`.
 */
export const verdictFromMeasurements = (m: AlphaMeasurements): FadeVerdict => {
  const fades = m.interiorSemiRatio > 0.02 && m.maxRampRatio > 0.08;

  const seeThrough = m.faintRatio + m.translucentRatio;
  const percent = (ratio: number) => Math.max(1, Math.round(ratio * 100));
  if (seeThrough >= SEE_THROUGH_FLAG_RATIO) {
    if (fades) {
      return {
        hasFade: true,
        confidence: 1,
        kind: "fade",
        reason: `It fades into transparency; about ${percent(seeThrough)}% of the artwork is see-through.`,
        source: "heuristic",
      };
    }
    if (m.faintRatio >= SEE_THROUGH_FLAG_RATIO) {
      return {
        hasFade: true,
        confidence: 1,
        kind: "semi-transparent",
        reason: `About ${percent(m.faintRatio)}% of the artwork is more than 50% transparent.`,
        source: "heuristic",
      };
    }
    return {
      hasFade: true,
      confidence: 1,
      kind: "translucent",
      reason: `About ${percent(seeThrough)}% of the artwork is partly transparent.`,
      source: "heuristic",
    };
  }
  if (m.semiRatio < 0.005) {
    return {
      hasFade: false,
      confidence: 0.95,
      kind: "opaque",
      reason: "No partial transparency beyond hard edges.",
      source: "heuristic",
    };
  }
  if (m.interiorSemiRatio < 0.01) {
    return {
      hasFade: false,
      confidence: 0.9,
      kind: "anti-aliasing",
      reason: "Partial transparency is confined to anti-aliased edges, which print normally.",
      source: "heuristic",
    };
  }
  if (fades) {
    return {
      hasFade: true,
      confidence: Math.min(0.9, 0.55 + m.interiorSemiRatio * 2 + m.maxRampRatio),
      kind: "fade",
      reason: "A sustained gradient into transparency was found, which DTF cannot reproduce.",
      source: "heuristic",
    };
  }
  return {
    hasFade: false,
    confidence: 0.6,
    kind: m.interiorSemiRatio > 0.05 ? "shadow" : "soft-edge",
    reason: "Semi-transparent areas look like a shadow or soft edge rather than a fade.",
    source: "heuristic",
  };
};

/** The alpha channel of `img`, drawn at most `maxEdge` on its long side. */
const readAlpha = (img: HTMLImageElement, maxEdge: number, smooth: boolean) => {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  canvas.width = 0;
  canvas.height = 0;
  return { alpha, w, h };
};

/* ------------------------------------------------------------------ *
 * Local fallback
 * ------------------------------------------------------------------ */

/**
 * Geometry-only transparency check, run in the browser.
 *
 * Mirrors the server's analysis so a verdict reached without the network is
 * consistent with one reached through it.
 */
export const detectFadeLocally = (url: string): Promise<FadeVerdict> =>
  new Promise<FadeVerdict>((resolve) => {
    const inconclusive: FadeVerdict = {
      hasFade: false,
      confidence: 0,
      kind: "none",
      reason: "",
      source: "heuristic",
    };

    const img = new Image();
    img.crossOrigin = "anonymous";

    // The decode can fail silently on a damaged file; without a bound this
    // promise would never settle.
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      resolve(inconclusive);
    }, 10_000);

    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(inconclusive);
    };

    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const small = readAlpha(img, ANALYSIS_PX, true);
        const sharpView = readAlpha(img, SEE_THROUGH_ANALYSIS_PX, false);
        if (!small || !sharpView) {
          resolve(inconclusive);
          return;
        }

        const { alpha, w, h } = small;
        let visible = 0;
        let semi = 0;
        let interiorSemi = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const a = alpha[y * w + x];
            if (a <= TRANSPARENT_AT) continue;
            visible++;
            if (a >= OPAQUE_AT) continue;
            semi++;
            if (!isEdge(alpha, w, h, x, y)) interiorSemi++;
          }
        }

        resolve(
          verdictFromMeasurements({
            semiRatio: semi / Math.max(1, visible),
            interiorSemiRatio: interiorSemi / Math.max(1, visible),
            maxRampRatio: longestRamp(alpha, w, h),
            ...(({ faint, translucent }) => ({ faintRatio: faint, translucentRatio: translucent }))(
              seeThroughShares(sharpView.alpha, sharpView.w, sharpView.h),
            ),
          }),
        );
      } catch {
        // A cross-origin asset taints the canvas and makes getImageData throw.
        resolve(inconclusive);
      }
    };

    img.src = url;
  });

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

/**
 * Verdicts by image URL, for the session.
 *
 * A verdict is a property of the image, and every edit that changes the image
 * (auto-crop, background removal, an AI edit) gives it a new URL — so keying by
 * URL is what lets a flag follow the artwork: an edited image is checked afresh,
 * and undoing back to an earlier URL finds its verdict already here.
 */
const verdicts = new Map<string, Promise<FadeVerdict>>();
const MAX_REMEMBERED = 500;

const remember = (url: string, verdict: Promise<FadeVerdict>) => {
  if (verdicts.size >= MAX_REMEMBERED) {
    const oldest = verdicts.keys().next().value;
    if (oldest !== undefined) verdicts.delete(oldest);
  }
  verdicts.set(url, verdict);
  return verdict;
};

/**
 * At most this many checks at once. Opening a saved design checks every image
 * on it, and each server check may be a model call.
 */
const MAX_CONCURRENT_CHECKS = 3;
let running = 0;
const waiting: Array<() => void> = [];

const withSlot = async <T>(work: () => Promise<T>): Promise<T> => {
  if (running >= MAX_CONCURRENT_CHECKS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
};

const runCheck = (url: string): Promise<FadeVerdict> =>
  withSlot(async () => {
    try {
      /**
       * Send a reference, never the image.
       *
       * For anything the editor produced locally — auto-crop, background
       * removal, an AI edit — `url` is a `data:` URL carrying the whole image.
       * Posting it inline put tens of megabytes in a JSON body and returned
       * `413 Payload Too Large`. `postAssetRef` uploads such an image once, as
       * raw bytes, and sends the hosted URL instead.
       */
      const response = await postAssetRef("/customer/assets/fade-check", { url });
      const parsed = parseFadeVerdict(response);
      if (parsed) return parsed;
    } catch {
      // Unreachable or errored — fall through to the local check rather than
      // leaving the image unchecked.
    }
    return detectFadeLocally(url);
  });

/**
 * Checks an image for transparency DTF cannot print.
 *
 * `serverVerdict` is the result an upload response already carried. Uploads run
 * the check server-side on the buffer they already hold, so the normal path
 * costs no extra request at all — this only reaches the network for images that
 * arrived some other way (a saved design, an edit that changed the image).
 */
export const checkFade = (url: string, serverVerdict?: unknown): Promise<FadeVerdict> => {
  const fromUpload = parseFadeVerdict(serverVerdict);
  if (fromUpload) return remember(url, Promise.resolve(fromUpload));
  return verdicts.get(url) ?? remember(url, runCheck(url));
};
