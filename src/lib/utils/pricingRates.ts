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

/*
 * The billing shape of a sheet, served alongside the rate.
 *
 * A gang sheet is cut from a fixed roll and has a minimum run length, so the
 * billed area is the roll width by the length — not the bounding box of the
 * artwork, which is what the editor used to price. On a sparse sheet those
 * differ several-fold, and the server bills the roll, so quoting the bounding
 * box showed a customer one number and charged them another.
 */
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
let settingsSnapshot = {
  pricePerSqFt: ratePerSqFt,
  sheetWidthIn,
  minSheetLengthIn,
};

const refreshSnapshot = () => {
  settingsSnapshot = { pricePerSqFt: ratePerSqFt, sheetWidthIn, minSheetLengthIn };
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
      /*
       * All three settings, not just the rate.
       *
       * This read `baseRatePerSqFt` alone, so an admin changing the roll width
       * or the minimum billable length was fetched and then thrown away — the
       * editor kept its compiled fallback of 10in for the life of the tab and
       * priced against a figure the server would not charge.
       */
      const width = Number(res?.sheetWidthIn);
      const minLength = Number(res?.minSheetLengthIn);

      const changed =
        value !== ratePerSqFt ||
        (Number.isFinite(width) && width > 0 && width !== sheetWidthIn) ||
        (Number.isFinite(minLength) && minLength > 0 && minLength !== minSheetLengthIn);

      ratePerSqFt = value;
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

/**
 * Re-read the settings when the tab is brought back to the front.
 *
 * Hydration ran once at start-up, so an admin changing the rate or the minimum
 * length did not reach anyone with the editor already open — they would price a
 * sheet at the old figures for as long as the tab lived, and only discover the
 * difference at checkout, where the server prices independently.
 *
 * Cheap: one request when a tab regains focus, and it no-ops if nothing moved.
 */
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
