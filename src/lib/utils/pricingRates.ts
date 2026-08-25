import { useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import { PRICING } from "../../config/artboard.config";

/**
 * The retail rate the editor prices sheets at, served by the admin.
 *
 * This used to be `PRICING.PRICE_PER_SQ_FT`, a constant compiled into the
 * bundle. Since the editor's price is what lands on the saved design and then
 * on the cart line, that constant — not the admin's Retail Pricing field — was
 * what actually charged every customer. Changing the published rate meant a
 * redeploy, and the admin field it contradicted was authoritative over nothing.
 *
 * Held in a module-level cell rather than context because the three call sites
 * sit in an effect hook, the editor and the header, with no common provider
 * between them.
 */
let ratePerSqFt: number = PRICING.FALLBACK_PRICE_PER_SQ_FT;

const listeners = new Set<() => void>();

export const getPricePerSqFt = () => ratePerSqFt;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/**
 * Returns a number, so `useSyncExternalStore` compares by value. Returning a
 * fresh object here would re-render on every store read.
 */
export const usePricePerSqFt = () =>
  useSyncExternalStore(subscribe, getPricePerSqFt, getPricePerSqFt);

let inflight: Promise<void> | null = null;

/**
 * Fetched once at start-up. On failure the compiled fallback stands rather than
 * blocking the editor — but it is logged, because a silently stale rate prices
 * real orders.
 */
export const hydratePricePerSqFt = (): Promise<void> => {
  if (inflight) return inflight;

  inflight = apiFetch("/customer/pricing")
    .then((res: any) => {
      const value = Number(res?.baseRatePerSqFt);
      if (!Number.isFinite(value) || value <= 0) {
        console.warn(
          "[pricing] server sent no usable baseRatePerSqFt; using compiled fallback",
          res?.baseRatePerSqFt,
        );
        return;
      }
      if (value !== ratePerSqFt) {
        ratePerSqFt = value;
        listeners.forEach((fn) => fn());
      }
    })
    .catch((err: unknown) => {
      console.warn("[pricing] could not load the retail rate; using compiled fallback", err);
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
};
