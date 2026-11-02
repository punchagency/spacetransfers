import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GLOBAL_PRICING,
  computeTotals,
  normalizeGlobalPricing,
} from "../services/pricing.service.js";

/**
 * `global_pricing.baseRatePerSqFt` was admin-editable but read by nothing that
 * charged anyone — the storefront priced from a constant compiled into the
 * client bundle, and two hard-coded `3.5` fallbacks sat in the quote path.
 * These lock in that the stored rate is now the one that prices a sheet.
 */

// What `getCartQuote` does per gang sheet, extracted so it can be asserted
// without standing up Mongo and a request.
const quoteUnitPrice = (areaSqFt: number, baseRatePerSqFt: number) =>
  areaSqFt * baseRatePerSqFt;

describe("retail rate — the admin's figure is the one that prices a sheet", () => {
  it("defaults to the rate the storefront was actually charging, not the decorative 24", () => {
    // Seeding 24.00 would have made deploying the wiring a sevenfold rise.
    assert.equal(DEFAULT_GLOBAL_PRICING.baseRatePerSqFt, 3.5);
  });

  it("prices a sheet from the configured rate", () => {
    const areaSqFt = (24.34 * 65.09) / 144; // 11.002018 sq ft, a real order
    assert.equal(Number(quoteUnitPrice(areaSqFt, 3.5).toFixed(2)), 38.51);
  });

  it("follows the admin when the rate changes", () => {
    const areaSqFt = 10;
    assert.equal(quoteUnitPrice(areaSqFt, 3.5), 35);
    assert.equal(quoteUnitPrice(areaSqFt, 24), 240);
    assert.equal(quoteUnitPrice(areaSqFt, 4.25), 42.5);
  });

  it("keeps a stored rate rather than substituting the default", () => {
    const p = normalizeGlobalPricing({
      baseRatePerSqFt: 4.75,
      shipping: { standard: 8.99, express: 24.99 },
      taxRatePct: 8,
    });
    assert.equal(p.baseRatePerSqFt, 4.75);
  });

  it("falls back to the default when the stored rate is missing or unusable", () => {
    for (const bad of [undefined, null, "", "  ", "abc", [], {}, NaN, Infinity, -1]) {
      const p = normalizeGlobalPricing({ baseRatePerSqFt: bad as any });
      assert.equal(p.baseRatePerSqFt, 3.5, `rejected: ${String(bad)}`);
    }
  });

  it("keeps an explicit zero, which is a legitimate setting for shipping and tax", () => {
    const p = normalizeGlobalPricing({
      baseRatePerSqFt: 3.5,
      shipping: { standard: 0, express: 0 },
      taxRatePct: 0,
    });
    assert.equal(p.shipping.standard, 0);
    assert.equal(p.taxRatePct, 0);
  });

  it("accepts a numeric string, which is what an admin form field submits", () => {
    const p = normalizeGlobalPricing({ baseRatePerSqFt: "4.25" });
    assert.equal(p.baseRatePerSqFt, 4.25);
  });

  it("does not let the sheet rate leak into shipping or tax", () => {
    // computeTotals takes the subtotal as given; the rate priced it upstream.
    const totals = computeTotals({
      subtotal: 38.51,
      shippingMethod: "standard",
      pricing: normalizeGlobalPricing({ baseRatePerSqFt: 24 }),
    });
    assert.equal(totals.shippingCost, 8.99);
    assert.equal(totals.tax, 3.08); // 8% of subtotal only, not of shipping
    assert.equal(totals.total, 50.58);
  });
});
