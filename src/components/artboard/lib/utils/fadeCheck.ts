import { apiFetch } from "../../../../lib/utils/api";
import { postAssetRef } from "../../../../lib/utils/payloadImages";

/**
 * Fade checking for the artboard.
 *
 * DTF lays a white underbase that is effectively binary — ink is either
 * deposited or it is not — so artwork that ramps into transparency prints as a
 * hard, ragged edge instead of a fade. Catching that before checkout is the
 * point of this check.
 *
 * The verdict comes from the server's AI checker by default. It sees the alpha
 * channel rendered as a greyscale map alongside a checkerboard composite, which
 * is what lets it tell a real fade from the three printable things that look
 * identical to a pixel count: anti-aliased edges, drop shadows and soft glows.
 *
 * The local check here is the fallback for when that is unreachable. It is a
 * strict improvement on what used to be the *only* rule — `semiTransparent /
 * visible > 0.05` — which flagged every anti-aliased cutout and every shadow.
 */

export type FadeKind =
  | "fade"
  | "anti-aliasing"
  | "shadow"
  | "soft-edge"
  | "opaque"
  | "none";

export interface FadeVerdict {
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
 * before it interrupts anyone.
 */
export const FADE_CONFIDENCE_THRESHOLD = 0.6;

/** Whether a verdict should actually raise a warning in the UI. */
export const shouldWarn = (verdict: FadeVerdict | undefined | null): boolean =>
  Boolean(verdict?.hasFade && verdict.confidence >= FADE_CONFIDENCE_THRESHOLD);

const isFadeKind = (value: unknown): value is FadeKind =>
  typeof value === "string" &&
  ["fade", "anti-aliasing", "shadow", "soft-edge", "opaque", "none"].includes(value);

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
    kind: isFadeKind(raw.kind) ? raw.kind : raw.hasFade ? "fade" : "none",
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "",
    source: raw.source === "ai" ? "ai" : "heuristic",
  };
};

/* ------------------------------------------------------------------ *
 * Local fallback
 * ------------------------------------------------------------------ */

const ANALYSIS_PX = 256;
const TRANSPARENT_AT = 8;
const OPAQUE_AT = 248;

/**
 * Geometry-only fade check, run in the browser.
 *
 * Mirrors the server's analysis so a verdict reached without the network is
 * consistent with one reached through it. The discriminating measure is
 * *interior* partial alpha: anti-aliasing is a 1–2px band whose neighbourhood
 * always contains both a fully opaque and a fully transparent pixel, whereas a
 * genuine fade has broad regions where everything nearby is also partial.
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
    // promise would never settle and would stall the upload that awaits it.
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
        const scale = Math.min(
          1,
          ANALYSIS_PX / Math.max(img.naturalWidth, img.naturalHeight, 1),
        );
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(inconclusive);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const alphaAt = (x: number, y: number) => data[(y * w + x) * 4 + 3];

        let visible = 0;
        let semi = 0;
        let interiorSemi = 0;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const a = alphaAt(x, y);
            if (a <= TRANSPARENT_AT) continue;
            visible++;
            if (a >= OPAQUE_AT) continue;
            semi++;

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
                const n = alphaAt(nx, ny);
                if (n >= OPAQUE_AT) sawOpaque = true;
                else if (n <= TRANSPARENT_AT) sawTransparent = true;
                if (sawOpaque && sawTransparent) break;
              }
            }
            if (!(sawOpaque && sawTransparent)) interiorSemi++;
          }
        }

        const semiRatio = semi / Math.max(1, visible);
        const interiorSemiRatio = interiorSemi / Math.max(1, visible);

        if (semiRatio < 0.005) {
          resolve({
            hasFade: false,
            confidence: 0.95,
            kind: "opaque",
            reason: "No partial transparency beyond hard edges.",
            source: "heuristic",
          });
          return;
        }

        if (interiorSemiRatio < 0.01) {
          resolve({
            hasFade: false,
            confidence: 0.9,
            kind: "anti-aliasing",
            reason: "Partial transparency is confined to anti-aliased edges, which print normally.",
            source: "heuristic",
          });
          return;
        }

        if (interiorSemiRatio > 0.02) {
          resolve({
            hasFade: true,
            confidence: Math.min(0.85, 0.6 + interiorSemiRatio * 2),
            kind: "fade",
            reason: "Large semi-transparent areas suggest a fade into transparency, which DTF cannot reproduce.",
            source: "heuristic",
          });
          return;
        }

        resolve({
          hasFade: false,
          confidence: 0.6,
          kind: "soft-edge",
          reason: "Semi-transparent areas look like a shadow or soft edge rather than a fade.",
          source: "heuristic",
        });
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
 * Checks an image for a fade, AI-first.
 *
 * `serverVerdict` is the result the upload response already carried. Uploads run
 * the check server-side on the buffer they already hold, so the normal path
 * costs no extra request at all — this only reaches the network for images that
 * arrived some other way (a saved design, an AI edit that changed the alpha).
 */
export const checkFade = async (
  url: string,
  serverVerdict?: unknown,
): Promise<FadeVerdict> => {
  const fromUpload = parseFadeVerdict(serverVerdict);
  if (fromUpload) return fromUpload;

  try {
    /**
     * Send a reference, never the image.
     *
     * `url` is whatever the item currently holds, and for anything the editor
     * produced locally — auto-crop, background removal, an AI edit — that is a
     * `data:image/png;base64,…` URL carrying the whole image. Posting it inline
     * put tens of megabytes in a JSON body and returned
     * `413 Payload Too Large` from `/customer/assets/fade-check`.
     *
     * `toHostedUrl` uploads such an image once, as raw bytes, and caches the
     * hosted URL it gets back — so the check sends ~120 characters, the server
     * fetches the original from storage, and any later operation on the same
     * image reuses the same upload rather than re-sending it.
     */
    const response = await postAssetRef("/customer/assets/fade-check", { url });
    const parsed = parseFadeVerdict(response);
    if (parsed) return parsed;
  } catch {
    // Unreachable or errored — fall through to the local check rather than
    // failing an upload over an advisory warning.
  }

  return detectFadeLocally(url);
};
