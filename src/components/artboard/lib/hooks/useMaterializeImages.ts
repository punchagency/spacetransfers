import { useEffect, useRef } from "react";
import { knownHostedUrl, toHostedUrl } from "../../../../lib/utils/payloadImages";
import type { ArtboardItem } from "../../types";

/**
 * Uploads canvas-produced artwork as soon as it appears on the board.
 *
 * This is the architectural half of the 413 fix. Every canvas operation —
 * auto-crop, background removal, colour removal, sticker borders, local AI
 * edits — writes a `data:image/png;base64,…` result onto the item, and that
 * string is the artwork itself. Left there it travels in the cart sync, the
 * design save, the order, and localStorage, and at print resolution each one is
 * tens of megabytes.
 *
 * Uploading at *checkout* would work but keeps the cost exactly where it hurts
 * most: on the click the customer is waiting on. Doing it here moves the upload
 * to the moment the edit finishes, when the customer is still working and a
 * background request is invisible — so by the time they reach checkout there is
 * nothing large left to send, and Place Order is a small JSON POST.
 *
 * A single sweep over items also means any future code path that produces a
 * data URL is covered without knowing this exists.
 */

/** Fields an artboard item can hold a canvas result in. */
const IMAGE_FIELDS = ["url", "croppedUrl", "uncroppedUrl"] as const;

/**
 * Below this an embedded image is not worth a round trip.
 *
 * Matches the uploader's own threshold so the two agree on what counts as
 * large; a mismatch would mean this hook repeatedly queues images the uploader
 * then declines to upload.
 */
const MIN_BYTES = 8 * 1024;

const isDataUrl = (value: unknown): boolean =>
  typeof value === "string" && value.startsWith("data:");

export const useMaterializeImages = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
) => {
  /** Data URLs already attempted, so a failure is not retried on every render. */
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    const pending: string[] = [];
    /**
     * Images this session has already uploaded, still sitting on a *new* item.
     *
     * Re-dropping the same files produces byte-identical crops, so the second
     * batch's data URLs are the same strings the first batch uploaded. Those
     * strings are in `attempted`, so the old code skipped them — but the swap
     * that retired them ran before these items existed, so nothing ever
     * replaced them and the second batch kept multi-megabyte base64 in React
     * state indefinitely. Every `setItems` then re-rendered a board carrying
     * hundreds of megabytes of strings, which is a large part of why the
     * *second* bulk upload was the one that ground to a halt.
     *
     * `toHostedUrl` already caches by data URL, so the answer is known
     * immediately and costs no request — it just has to be applied.
     */
    const alreadyHosted = new Map<string, string>();

    for (const item of items) {
      for (const field of IMAGE_FIELDS) {
        const value = (item as any)[field];
        if (!isDataUrl(value) || value.length < MIN_BYTES) continue;

        const known = knownHostedUrl(value);
        if (known) {
          alreadyHosted.set(value, known);
        } else if (!attempted.current.has(value)) {
          pending.push(value);
        }
      }
    }

    if (alreadyHosted.size > 0) {
      setItems((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          let updated = item;
          for (const field of IMAGE_FIELDS) {
            const swap = alreadyHosted.get((updated as any)[field]);
            if (swap) {
              updated = { ...updated, [field]: swap };
              changed = true;
            }
          }
          return updated;
        });
        return changed ? next : prev;
      });
    }

    if (pending.length === 0) return;

    // De-duplicated before any request: `url` and `croppedUrl` are usually the
    // same string, and a sheet repeats one graphic across many placements.
    const unique = Array.from(new Set(pending));
    for (const dataUrl of unique) attempted.current.add(dataUrl);

    let cancelled = false;

    (async () => {
      for (const dataUrl of unique) {
        if (cancelled) return;
        try {
          const url = await toHostedUrl(dataUrl);
          if (cancelled || url === dataUrl) continue;

          /**
           * Swapped in wherever this exact image still appears.
           *
           * Matched by value rather than item id, so a copy, a reorder, or an
           * undo that restored the item in the meantime is still upgraded.
           * Returning `prev` unchanged when nothing matched matters too: the
           * item may have been deleted while the upload ran, and a new array
           * identity would re-run every downstream effect for nothing.
           */
          setItems((prev) => {
            let changed = false;
            const next = prev.map((item) => {
              let updated = item;
              for (const field of IMAGE_FIELDS) {
                if ((updated as any)[field] === dataUrl) {
                  updated = { ...updated, [field]: url };
                  changed = true;
                }
              }
              return updated;
            });
            return changed ? next : prev;
          });
        } catch {
          // Upload failed — the item keeps its data URL and stays fully usable.
          // Checkout's own pass will try again before sending.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items, setItems]);
};
