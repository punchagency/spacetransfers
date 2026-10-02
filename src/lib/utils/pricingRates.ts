import { useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import { PRICING } from "../../config/artboard.config";

let ratePerSqFt: number = PRICING.FALLBACK_PRICE_PER_SQ_FT;

let sheetWidthIn = 23.5;
let minSheetLengthIn = 10;

export const getSheetWidthIn = () => sheetWidthIn;
export const getMinSheetLengthIn = () => minSheetLengthIn;

/**
 * A snapshot of every pricing setting, replaced only when one actually changes.
 *
 * `useSyncExternalStore` compares by identity, so a component subscribing to
 * this re-renders whenever ANY of the three move — which is what makes an admin
 * changing the minimum length reach the artboard.
 *
 * Subscribing to the rate alone did not. The rate is a number, so the store
 * compared 3.5 to 3.5, React bailed out, and the effect that computes the
 * header never re-ran: the board kept the compiled fallback of 10in for the
 * whole session, reload included, because hydration resolves *after* mount and
 * changed nothing the editor was watching.
 */
let loaded = false;

let settingsSnapshot = {
  pricePerSqFt: ratePerSqFt,
  sheetWidthIn,
  minSheetLengthIn,
  loaded,
};

const refreshSnapshot = () => {
  settingsSnapshot = { pricePerSqFt: ratePerSqFt, sheetWidthIn, minSheetLengthIn, loaded };
};

export const getPricingSettings = () => settingsSnapshot;

/** Re-renders on any pricing change, not only a change of rate. */
export const usePricingSettings = () =>
  useSyncExternalStore(subscribe, getPricingSettings, getPricingSettings);

/** The dimensions a sheet is billed on, from the dimensions its artwork occupies. */
export const billableSheetDimensions = (usedHeightIn: number) => {
  /*
   * An empty board reports the minimum, not zero.
   *
   * "0.00sf | 0.00in wide x 0.00in long" tells a customer nothing about what
   * their first image will cost. The floor is the honest answer: any sheet at
   * all is billed at least the roll width by the minimum length, so that is the
   * number to show before anything is placed.
   */
  const heightIn = Math.max(usedHeightIn, minSheetLengthIn);
  return {
    widthIn: sheetWidthIn,
    heightIn,
    areaSf: +((sheetWidthIn * heightIn) / 144).toFixed(2),
    /** True while the minimum is what is setting the length, including when empty. */
    atMinimum: usedHeightIn < minSheetLengthIn,
  };
};

const listeners = new Set<() => void>();

export const getPricePerSqFt = () => ratePerSqFt;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

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
      const width = Number(res?.sheetWidthIn);
      const minLength = Number(res?.minSheetLengthIn);

      const changed =
        !loaded ||
        value !== ratePerSqFt ||
        (Number.isFinite(width) && width > 0 && width !== sheetWidthIn) ||
        (Number.isFinite(minLength) && minLength > 0 && minLength !== minSheetLengthIn);

      ratePerSqFt = value;
      loaded = true;
      if (Number.isFinite(width) && width > 0) sheetWidthIn = width;
      if (Number.isFinite(minLength) && minLength > 0) minSheetLengthIn = minLength;

      if (changed) {
        // A fresh object, so identity-comparing subscribers actually re-render.
        refreshSnapshot();
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

export const watchPricingSettings = (): (() => void) => {
  const onFocus = () => {
    void hydratePricePerSqFt();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void hydratePricePerSqFt();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
  };
};
