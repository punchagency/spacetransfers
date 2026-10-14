import { apiFetch } from "../../../../../lib/utils/api";
import { requireAccount } from "../../../../../lib/requireAccount";
import { postAssetRef } from "../../../../../lib/utils/payloadImages";
import type { AiEditProvider, AiEditRequest, AiEditResult } from "../types";
import { AiEditAbortedError } from "../types";

/**
 * Generative editing routed through our own backend, which holds the model
 * credentials and normalises whichever vendor is configured server-side
 * (Replicate / Stability / OpenAI images / …). The client stays vendor-agnostic:
 * to change vendors, change the server handler — this file does not move.
 */

interface AiEditCapabilities {
  enabled: boolean;
  intents?: string[];
}

const DEFINITIVE_TTL_MS = 5 * 60_000;
const FAILURE_BACKOFF_MS = 10_000;

interface CacheEntry {
  value: AiEditCapabilities;
  at: number;
  /** True when the server actually answered, false when the request failed. */
  definitive: boolean;
}

let cache: CacheEntry | null = null;
// De-dupes concurrent probes (a batch edit asks once per item).
let inflight: Promise<AiEditCapabilities> | null = null;

const isFresh = (entry: CacheEntry): boolean => {
  const ttl = entry.definitive ? DEFINITIVE_TTL_MS : FAILURE_BACKOFF_MS;
  return Date.now() - entry.at < ttl;
};

const fetchCapabilities = (): Promise<AiEditCapabilities> => {
  if (cache && isFresh(cache)) return Promise.resolve(cache.value);
  if (inflight) return inflight;

  inflight = apiFetch("/customer/assets/ai-edit/capabilities")
    .then((data: any) => {
      const value: AiEditCapabilities = {
        enabled: Boolean(data?.enabled),
        intents: Array.isArray(data?.intents) ? data.intents : undefined,
      };
      cache = { value, at: Date.now(), definitive: true };
      return value;
    })
    .catch(() => {
      // Unreachable ≠ unconfigured. Recorded as non-definitive so the next
      // attempt re-probes instead of inheriting this failure forever.
      const value: AiEditCapabilities = { enabled: false };
      cache = { value, at: Date.now(), definitive: false };
      return value;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
};

/** Lets the app re-probe immediately, e.g. after an admin connects a model. */
export const resetServerCapabilities = () => {
  cache = null;
  inflight = null;
};

export const serverProvider: AiEditProvider = {
  id: "server",
  label: "AI",
  priority: 10,
  // Generative editing is the fallback for everything, including free-form prompts.
  supports: () => true,

  async isAvailable() {
    const caps = await fetchCapabilities();
    return caps.enabled;
  },

  async edit({ imageUrl, prompt, intent, seed, signal, onProgress }: AiEditRequest): Promise<AiEditResult> {
    if (signal?.aborted) throw new AiEditAbortedError();

    onProgress?.({ phase: "Sending to the model…", pct: 6 });

    // Generative endpoints report no intermediate progress, so ramp a synthetic
    // bar that stalls below 100 until the real response lands.
    let pct = 10;
    const ticker = window.setInterval(() => {
      pct = Math.min(90, pct + 3);
      onProgress?.({ phase: "Generating…", pct });
    }, 800);

    try {
      // Chained AI edits operate on the previous result, which is a data: URL
      // held in state — so this is the endpoint most likely to be handed a full
      // image. `postAssetRef` uploads it once and sends the reference.
      requireAccount("use AI edits");
      const result = await postAssetRef(
        "/customer/assets/ai-edit",
        { url: imageUrl, prompt, intent, seed },
        // The server allows the model two minutes; the request waits a little longer.
        { signal, timeoutMs: 150_000 },
      );

      if (signal?.aborted) throw new AiEditAbortedError();
      if (!result?.url) throw new Error("The model returned no image");

      onProgress?.({ phase: "Done", pct: 100 });
      return {
        url: result.url,
        widthPx: result.widthPx,
        heightPx: result.heightPx,
        originalWidthPx: result.originalWidthPx,
        originalHeightPx: result.originalHeightPx,
        // Generative edits repaint in place at a fixed canvas size; the subject's
        // print box is unchanged, so geometry must be preserved.
        reframed: Boolean(result.reframed),
        provider: result.provider || "server",
        seed: typeof result.seed === "number" ? result.seed : undefined,
        model: result.model,
      };
    } catch (error: any) {
      // fetch surfaces an aborted request as AbortError — translate it so the
      // caller treats a cancel as a no-op rather than a failed generation.
      if (error?.name === "AbortError" || signal?.aborted) throw new AiEditAbortedError();
      // The server said the model can't serve edits right now — drop the cached
      // "enabled" so the panel greys the model-only actions on its next check.
      if (error?.status === 503) resetServerCapabilities();
      throw error;
    } finally {
      window.clearInterval(ticker);
    }
  },
};
