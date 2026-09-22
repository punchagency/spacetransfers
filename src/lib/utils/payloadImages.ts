import { apiFetch } from "./api";

/**
 * Uploads canvas-produced artwork so requests carry references, not pixels.
 *
 * Every canvas operation in the editor — auto-crop, background removal, colour
 * removal, sticker borders, local AI edits — returns its result as a
 * `data:image/png;base64,…` string, which then lives on the artboard item. That
 * string *is* the artwork: at print resolution a single one runs to tens of
 * megabytes, and base64 adds a further third on top.
 *
 * Carried into an order that is what produces 413 Payload Too Large, and it is
 * also why checkout felt slow — the browser serialised, and the server parsed,
 * the entire artwork set on the click that should feel instant.
 *
 * The fix is ordering, not limits: each image is uploaded once, when it is
 * produced, and everything afterwards references the hosted URL. By the time
 * the customer reaches checkout there is nothing large left to send.
 */

/**
 * Below this a data URL is cheap enough to leave alone.
 *
 * Uploading a tiny inline SVG or a 1px placeholder would spend a round trip to
 * save a few hundred bytes. Far below any size that could accumulate into a
 * limit breach across a whole sheet.
 */
const MIN_BYTES_TO_UPLOAD = 8 * 1024;

/** Every field across items, cart rows and order payloads that can hold one. */
const IMAGE_FIELDS = [
  "url",
  "croppedUrl",
  "uncroppedUrl",
  "originalUrl",
  "thumbnailUrl",
  "image",
  "previewImage",
  "thumbnail",
] as const;

export const isDataUrl = (value: unknown): boolean =>
  typeof value === "string" && value.startsWith("data:");

/** Serialized size in bytes. Used by guards, diagnostics and tests. */
export const payloadBytes = (value: unknown): number => {
  try {
    return new Blob([JSON.stringify(value) ?? ""]).size;
  } catch {
    // Circular or unserialisable — report the ceiling so callers fail closed
    // rather than waving through something they could not measure.
    return Number.POSITIVE_INFINITY;
  }
};

/**
 * Uploads already performed, keyed by the data URL.
 *
 * Process-lifetime, so an image handled during editing is never re-uploaded at
 * checkout, and a retried submit costs nothing. In-flight promises are cached
 * too — the artboard can ask for the same image from several places in the same
 * tick, and without this each would start its own upload.
 */
const hosted = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/**
 * Bound on a single materialize attempt.
 *
 * Without this, a slow or stuck upload left the customer staring at a
 * "Placing order…" button with zero feedback for as long as the network — or
 * a server-side bug — chose to take; a reported case ran 54 seconds before
 * finally failing. Aborting at a sane ceiling turns an indefinite hang into a
 * bounded, retryable failure with an honest message, and lets the retry below
 * actually get a second attempt in rather than the customer giving up first.
 */
const MATERIALIZE_TIMEOUT_MS = 20_000;

/** Short pause before the retry, so a struggling server isn't hit twice in the same instant. */
const RETRY_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a failed attempt is worth retrying.
 *
 * A 4xx is the server deliberately rejecting this specific upload (a corrupt
 * file, an oversized image past its own limit) — a second attempt with the
 * same bytes fails identically. A 5xx, a dropped connection, or this file's
 * own timeout are all transient by nature, so one retry is cheap insurance
 * against exactly the kind of blip that shouldn't fail an order.
 *
 * A response with no `.status` at all is NOT retried by default — that shape
 * covers two things, and only one of them is transient. `fetch` itself
 * throwing (no response ever arrived) is a `TypeError` and is retried. Our
 * own "the server answered 2xx but with something unusable" error — thrown
 * deliberately inside `materializeOnce` — is not a `TypeError` and is not
 * retried, because a second attempt with the same bytes would get the same
 * malformed response.
 */
export const isRetryable = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const status = (error as { status?: number } | undefined)?.status;
  if (typeof status === "number") return status >= 500;
  // `apiFetch` reports a lost connection as `network`, not the raw TypeError,
  // so both shapes count as transient.
  if ((error as { network?: boolean } | undefined)?.network) return true;
  return error instanceof TypeError;
};

/**
 * Reduces a failed materialize attempt to something safe to show a customer.
 *
 * Only two shapes are actually at risk of leaking something unvetted:
 *
 *  - A 5xx response. Its message is not worded for a customer — it can be a
 *    raw vendor error (Cloudinary's own wording reaching the client verbatim
 *    is exactly the failure this guards against) or a stack trace fragment.
 *  - A raw `TypeError` from `fetch` itself (a real network failure — no
 *    response arrived at all), whose message is the browser's own internal
 *    wording ("Failed to fetch"), not ours.
 *
 * Both are logged for diagnostics and replaced with a generic, actionable
 * message. Everything else already carries a message meant for a customer:
 * a 4xx is worded by our own server specifically for this audience (see
 * `imageBounds.ts`, `documentSize.ts`), and anything with neither a status
 * nor a TypeError was thrown deliberately by our own client code (e.g.
 * `materializeOnce`'s "no url in response") using wording chosen for the
 * same reason — so both are shown as-is.
 */
export const toCustomerMessage = (error: unknown): string => {
  const status = (error as { status?: number } | undefined)?.status;
  const isUnvetted = (typeof status === "number" && status >= 500) || error instanceof TypeError;

  if (isUnvetted) {
    console.error("[toHostedUrl] materialize failed", error);
    return "Your artwork couldn't be uploaded right now. Please try again in a moment.";
  }
  return (error as Error)?.message || "That image could not be uploaded. Please try again.";
};

const materializeOnce = async (blob: Blob, signal: AbortSignal): Promise<string> => {
  const response = await apiFetch("/customer/assets/materialize", {
    method: "POST",
    body: blob,
    // Explicit: apiFetch defaults to application/json, which would make the
    // server try to parse image bytes as JSON.
    headers: { "Content-Type": "application/octet-stream" },
    signal,
  });

  const next = typeof response?.url === "string" ? response.url : null;
  if (!next || next.startsWith("data:")) {
    throw new Error("The edited image could not be uploaded. Please try again.");
  }
  return next;
};

/**
 * Uploads one embedded image and returns its hosted URL.
 *
 * Sent as raw bytes rather than base64 in JSON: `fetch` decodes a data URL to a
 * Blob natively, which avoids both the 4/3 inflation on the wire and a second
 * multi-megabyte copy in memory, and lets the server skip a JSON parse over the
 * whole thing.
 *
 * The `hosted` cache is what guarantees an image is uploaded exactly once: it
 * is keyed by the data URL and lives for the process, so the board sweep, a
 * later edit, the cart sync and checkout all reuse the first upload's result
 * rather than re-sending the bytes. `inflight` does the same for uploads that
 * are still running, so several call sites asking in the same tick share one
 * request instead of racing.
 *
 * Throws on failure rather than returning the original. Silently keeping the
 * data URL would push an oversized body at the server again — and on the order
 * path it could persist artwork the print pipeline cannot resolve, which is
 * worse than a retryable error. The thrown message is always customer-safe —
 * see `toCustomerMessage`.
 */
export const toHostedUrl = async (url: string): Promise<string> => {
  if (!isDataUrl(url) || url.length < MIN_BYTES_TO_UPLOAD) return url;

  const done = hosted.get(url);
  if (done) return done;

  const running = inflight.get(url);
  if (running) return running;

  const upload = (async () => {
    const blob = await (await fetch(url)).blob();

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MATERIALIZE_TIMEOUT_MS);
      try {
        const next = await materializeOnce(blob, controller.signal);
        hosted.set(url, next);
        return next;
      } catch (error) {
        if (attempt === 0 && isRetryable(error)) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new Error(toCustomerMessage(error));
      } finally {
        clearTimeout(timer);
      }
    }
  })();

  inflight.set(url, upload);
  try {
    return await upload;
  } finally {
    inflight.delete(url);
  }
};

/** A hosted URL for an image already uploaded, or null if it hasn't been. */
export const knownHostedUrl = (url: string): string | null => hosted.get(url) ?? null;

/**
 * Posts an image operation to an asset endpoint, sending a reference only.
 *
 * Every `/customer/assets/*` endpoint takes a `url` and fetches the image
 * server-side. When that `url` is a `data:` URL — which it is for anything the
 * editor produced locally: auto-crop, background removal, an AI edit — posting
 * it inline puts the whole image in a JSON body and the request comes back
 * `413 Payload Too Large`.
 *
 * Centralised deliberately. The same bug appeared independently at `fade-check`,
 * `upscale` and `ai-edit`, because each call site had to remember to
 * materialize first. Routing them through one function means the next endpoint
 * added inherits the behaviour instead of rediscovering the bug.
 *
 * The upload is cached by `toHostedUrl`, so several operations on the same
 * image cost one upload between them.
 */
export const postAssetRef = async <T = any>(
  endpoint: string,
  body: { url: string } & Record<string, unknown>,
  init?: RequestInit,
): Promise<T> => {
  const { url, ...rest } = body;
  const referenceUrl = await toHostedUrl(url);
  return apiFetch(endpoint, {
    ...init,
    method: "POST",
    body: JSON.stringify({ url: referenceUrl, ...rest }),
  });
};

/**
 * Whether a structure holds any embedded image worth uploading.
 *
 * Short-circuits on the first match rather than walking the whole structure
 * (which is what `collect` does, correctly, when it needs every image) —
 * this only needs a yes/no answer, typically to decide whether to show a
 * "finalizing artwork" indicator before doing the real work.
 *
 * Deliberately not a `JSON.stringify`-based check: a payload holding
 * embedded artwork is exactly the shape that made `JSON.stringify` throw
 * `RangeError: Invalid string length` elsewhere in this app (see
 * `assetIdentity.ts`) — a presence check must not pay that cost, or risk
 * that failure, just to answer "is there anything here?".
 */
export const hasEmbeddedImages = (node: unknown): boolean => {
  if (Array.isArray(node)) return node.some((entry) => hasEmbeddedImages(entry));
  if (!node || typeof node !== "object") return false;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (
      (IMAGE_FIELDS as readonly string[]).includes(key) &&
      isDataUrl(value) &&
      (value as string).length >= MIN_BYTES_TO_UPLOAD
    ) {
      return true;
    }
    if (value && typeof value === "object" && hasEmbeddedImages(value)) return true;
  }
  return false;
};

/** Collects every distinct embedded image anywhere in a structure. */
const collect = (node: unknown, found: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const entry of node) collect(entry, found);
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (
      (IMAGE_FIELDS as readonly string[]).includes(key) &&
      isDataUrl(value) &&
      (value as string).length >= MIN_BYTES_TO_UPLOAD
    ) {
      found.add(value as string);
    } else if (value && typeof value === "object") {
      collect(value, found);
    }
  }
};

/** Rebuilds a structure with embedded images swapped for their hosted URLs. */
const rewrite = <T>(node: T, table: Map<string, string>): T => {
  if (Array.isArray(node)) return node.map((entry) => rewrite(entry, table)) as unknown as T;
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string") {
      // Only image-bearing keys are substituted, so an unrelated string that
      // happens to equal an uploaded value is never rewritten.
      out[key] = (IMAGE_FIELDS as readonly string[]).includes(key)
        ? table.get(value) ?? value
        : value;
    } else if (value && typeof value === "object") {
      out[key] = rewrite(value, table);
    } else {
      out[key] = value;
    }
  }
  return out as T;
};

/**
 * Replaces every embedded image in a request body with a hosted URL.
 *
 * The safety net rather than the mechanism: the artboard uploads as it edits,
 * so by checkout this normally finds nothing and returns immediately. It exists
 * for the cases that beat that — a customer who checks out mid-upload, or an
 * earlier upload that failed.
 *
 * Collects first and uploads each distinct image once in parallel, so a sheet
 * repeating one graphic across hundreds of placements costs one upload rather
 * than hundreds. Returns a new object; the caller's state is untouched, so a
 * failed submit stays retryable.
 */
export const stripEmbeddedImages = async <T>(payload: T): Promise<T> => {
  const found = new Set<string>();
  collect(payload, found);
  if (found.size === 0) return payload;

  const table = new Map<string, string>();
  await Promise.all(
    Array.from(found, async (dataUrl) => {
      table.set(dataUrl, await toHostedUrl(dataUrl));
    }),
  );

  return rewrite(payload, table);
};
