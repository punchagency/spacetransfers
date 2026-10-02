import { useEffect, useRef, useState } from "react";
import { checkFade, type FadeVerdict } from "../utils/fadeCheck";

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
