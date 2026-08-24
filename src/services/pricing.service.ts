import { Settings } from "../models/settings.model.js";

/**
 * Single source of truth for what a customer is charged.
 *
 * Before this existed, five places computed an order's money and none of them
 * agreed. On a $100 express order the cart showed $119.99, Stripe charged
 * $132.99, and the saved order recorded $119.99 — so the customer saw one
 * number, paid another, and the record matched neither.
 *
 * Rates live in the `global_pricing` settings document, which the admin console
 * edits under Settings → General. Everything that touches money reads them from
 * here: the cart quote, the Stripe PaymentIntent, and the order that gets
 * saved. Changing a rate is an admin action, not a deploy.
 */

export interface GlobalPricing {
  baseRatePerSqFt: number;
  shipping: { standard: number; express: number };
  taxRatePct: number;
}

/**
 * Used when the settings document does not exist yet. Mirrors the fallback the
 * admin `getGlobalPricing` endpoint returns, so a fresh install and a
 * configured one behave identically.
 */
export const DEFAULT_GLOBAL_PRICING: GlobalPricing = {
  baseRatePerSqFt: 24.0,
  shipping: { standard: 8.99, express: 24.99 },
  taxRatePct: 8.0,
};

const roundToTwo = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const finiteOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Reads the configured rates, falling back field-by-field rather than
 * all-or-nothing: a settings document saved with one bad value should not
 * silently discard the operator's other three.
 */
export const getGlobalPricing = async (): Promise<GlobalPricing> => {
  const doc = await Settings.findOne({ key: "global_pricing" }).lean();
  const v = (doc as any)?.value || {};
  return {
    baseRatePerSqFt: finiteOr(v.baseRatePerSqFt, DEFAULT_GLOBAL_PRICING.baseRatePerSqFt),
    shipping: {
      standard: finiteOr(v.shipping?.standard, DEFAULT_GLOBAL_PRICING.shipping.standard),
      express: finiteOr(v.shipping?.express, DEFAULT_GLOBAL_PRICING.shipping.express),
    },
    taxRatePct: finiteOr(v.taxRatePct, DEFAULT_GLOBAL_PRICING.taxRatePct),
  };
};

export type ShippingMethod = "standard" | "express";

export const normalizeShippingMethod = (method: unknown): ShippingMethod =>
  String(method || "").toLowerCase() === "express" ? "express" : "standard";

export interface OrderTotals {
  subtotal: number;
  shippingCost: number;
  tax: number;
  total: number;
  currency: "USD";
}

/**
 * The arithmetic, kept pure so it can be unit-tested and so the quote, the
 * charge and the saved order provably produce the same numbers from the same
 * inputs.
 *
 * Tax is applied to the subtotal only, not to shipping, and is not conditioned
 * on the destination country. The previous quote path taxed only when the
 * country string was exactly "United States" — so a client sending "US" got
 * zero tax — while the charge path taxed unconditionally. Since fulfilment is
 * US-only (ShipStation rejects non-US addresses outright), taxing
 * unconditionally is both simpler and the behaviour that was already being
 * charged.
 */
export const computeTotals = ({
  subtotal,
  shippingMethod,
  pricing,
}: {
  subtotal: number;
  shippingMethod: unknown;
  pricing: GlobalPricing;
}): OrderTotals => {
  const safeSubtotal = roundToTwo(Math.max(0, finiteOr(subtotal, 0)));
  const method = normalizeShippingMethod(shippingMethod);
  const shippingCost = roundToTwo(pricing.shipping[method]);
  const tax = roundToTwo(safeSubtotal * (pricing.taxRatePct / 100));
  const total = roundToTwo(safeSubtotal + shippingCost + tax);
  return { subtotal: safeSubtotal, shippingCost, tax, total, currency: "USD" };
};

/**
 * Subtotal for a list of line items. Accepts the shapes the cart and the order
 * payload each use (`quantity`/`copies`, `unitPrice`/`price`) so one function
 * can serve both callers.
 */
export const computeSubtotal = (items: unknown[]): number =>
  roundToTwo(
    (Array.isArray(items) ? items : []).reduce((sum: number, it: any) => {
      const qty = finiteOr(it?.quantity ?? it?.copies, 1);
      const unit = finiteOr(it?.unitPrice ?? it?.price, 0);
      return sum + qty * unit;
    }, 0),
  );

/** Convenience: load the configured rates and price a set of items in one call. */
export const priceItems = async (
  items: unknown[],
  shippingMethod: unknown,
): Promise<OrderTotals> => {
  const pricing = await getGlobalPricing();
  return computeTotals({ subtotal: computeSubtotal(items), shippingMethod, pricing });
};
