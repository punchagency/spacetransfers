import { useEffect, useState } from "react";
import { getToken } from "../../../../lib/utils/auth";
import { checkArtworkRights, isHeld, itemImageUrls, type ImageRights } from "../../../../lib/utils/rights";

/**
 * The rights check's verdict for each image on the board, by item, so a held
 * image stays marked after a reload and its mark clears once an admin approves
 * it. Asks only for verdicts already reached: showing the board never pays for
 * a check. Signed-in customers only; a guest's images are checked at checkout.
 */
const TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; rights: ImageRights }>();

export const useRightsVerdicts = (items: any[]): ReadonlyMap<number, ImageRights> => {
  const [byItem, setByItem] = useState<ReadonlyMap<number, ImageRights>>(new Map());
  const key = items.map((it) => `${it.id}:${itemImageUrls(it).join(",")}`).join("|");

  useEffect(() => {
    if (!getToken() || !items.length) {
      setByItem(new Map());
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      const urls = [...new Set(items.flatMap(itemImageUrls))];
      const stale = urls.filter((u) => !cache.has(u) || Date.now() - cache.get(u)!.at > TTL_MS);
      if (stale.length) {
        try {
          for (const r of await checkArtworkRights(stale, { screen: false })) cache.set(r.url, { at: Date.now(), rights: r });
        } catch {
          // Shown again on the next change; checkout checks regardless.
        }
      }
      if (!alive) return;
      const next = new Map<number, ImageRights>();
      for (const it of items) {
        const held = itemImageUrls(it).map((u) => cache.get(u)?.rights).find((r) => r && r.verdict !== "unchecked" && isHeld(r));
        if (held) next.set(it.id, { ...held, name: it.name || held.name });
      }
      setByItem(next);
    }, 800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `key` captures the items' ids and images.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return byItem;
};
