import { useEffect, useRef, useState } from "react";
import { checkFade, type FadeVerdict } from "../utils/fadeCheck";

/**
 * Transparency verdicts for every image on the board, keyed by image URL.
 *
 * The flag used to be written onto an item once, when it was dropped, and a
 * banner timer cleared it after seven seconds. So it was never re-checked after
 * an edit that changed the image, it was gone when a saved design was reopened
 * (the fields were never saved), and the banner vanished while the artwork was
 * still on the sheet.
 *
 * Deriving it from the URL fixes all three at once: every edit gives an image a
 * new URL, which is checked; a reopened design's URLs are checked on load; and
 * the flag lasts exactly as long as the image does. Verdicts are remembered per
 * URL (`checkFade`), so undo, redo and repeated copies cost nothing.
 */
export function useTransparencyVerdicts(items: ReadonlyArray<{ url: string }>) {
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, FadeVerdict>>(() => new Map());
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Forget images no longer on the board, so edited-away data URLs are not
    // held for the session. Undo brings a URL back; its check is remembered.
    const present = new Set(items.map((it) => it.url));
    for (const url of requested.current) {
      if (!present.has(url)) requested.current.delete(url);
    }
    setVerdicts((prev) => {
      if ([...prev.keys()].every((url) => present.has(url))) return prev;
      return new Map([...prev].filter(([url]) => present.has(url)));
    });

    for (const { url } of items) {
      if (!url || requested.current.has(url)) continue;
      requested.current.add(url);
      void checkFade(url).then((verdict) => {
        if (!mounted.current) return;
        setVerdicts((prev) => {
          if (prev.get(url) === verdict) return prev;
          const next = new Map(prev);
          next.set(url, verdict);
          return next;
        });
      });
    }
  }, [items]);

  return verdicts;
}
