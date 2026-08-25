import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";

/**
 * This decides what a print partner is actually paid, and had no direct
 * coverage. The rounding case below was a real defect: area was rounded to two
 * decimals before being priced, so the payout moved a cent in whichever
 * direction the third decimal fell.
 */

const sheet = (w: number, h: number, quantity = 1) => [
  { widthIn: w, heightIn: h, sheetWidthIn: w, sheetHeightIn: h, quantity },
];

describe("computePartnerCostBreakdown — money is rounded once, at the end", () => {
  it("prices the exact area, not the area rounded to two decimals", () => {
    // 23.5 x 23.5 = 3.835069 sq ft. Rounding area first gives 3.84 → $9.60.
    const r = computePartnerCostBreakdown({
      items: sheet(23.5, 23.5),
      partnerPricing: { baseRatePerSqFt: 2.5 },
      priority: null,
      adjustments: [],
    });
    assert.equal(r.base, 9.59);
    assert.equal(r.subtotal, 9.59);
  });

  it("still reports area rounded, for display", () => {
    const r = computePartnerCostBreakdown({
      items: sheet(23.5, 23.5),
      partnerPricing: { baseRatePerSqFt: 2.5 },
      priority: null,
      adjustments: [],
    });
    assert.equal(r.totalSqFt, 3.84);
  });

  it("falls back to the default rate when the partner has none configured", () => {
    const r = computePartnerCostBreakdown({
      items: sheet(12, 12), // exactly 1 sq ft
      partnerPricing: {},
      priority: null,
      adjustments: [],
    });
    assert.equal(r.totalSqFt, 1);
    assert.equal(r.base, 2.5);
  });

  it("multiplies by quantity", () => {
    const r = computePartnerCostBreakdown({
      items: sheet(12, 12, 4),
      partnerPricing: { baseRatePerSqFt: 3 },
      priority: null,
      adjustments: [],
    });
    assert.equal(r.base, 12);
  });
});

describe("computePartnerCostBreakdown — tiers", () => {
  const tiered = [
    { minSqFt: 0, maxSqFt: 4, rate: 3 },
    { minSqFt: 4, maxSqFt: null, rate: 2 },
  ];

  it("selects the tier on exact area, so a sheet just under a boundary is not rounded across it", () => {
    // 23.98 x 24 is 3.996667 sq ft, which rounds to 4.00 — the old code would
    // have jumped it into the cheaper tier and underpaid the partner.
    const w = 23.98, h = 24;
    const exact = (w * h) / 144;
    assert.ok(exact < 4 && Number(exact.toFixed(2)) === 4, "fixture must straddle the boundary");

    const r = computePartnerCostBreakdown({
      items: sheet(w, h),
      partnerPricing: { baseRatePerSqFt: 10, tiered },
      priority: null,
      adjustments: [],
    });
    assert.equal(r.appliedRatePerSqFt, 3, "must stay in the sub-4 sq ft tier");
  });

  it("uses the higher-volume tier once genuinely over the boundary", () => {
    const r = computePartnerCostBreakdown({
      items: sheet(24, 36), // 6 sq ft
      partnerPricing: { baseRatePerSqFt: 10, tiered },
      priority: null,
      adjustments: [],
    });
    assert.equal(r.appliedRatePerSqFt, 2);
    assert.equal(r.base, 12);
  });
});

describe("computePartnerCostBreakdown — surcharges", () => {
  const pricing = {
    baseRatePerSqFt: 2.5,
    surcharges: { rushPct: 10, specialInkFlat: 5 },
  };

  it("adds the rush percentage only for URGENT orders", () => {
    const normal = computePartnerCostBreakdown({
      items: sheet(12, 12), partnerPricing: pricing, priority: "NORMAL", adjustments: [],
    });
    const urgent = computePartnerCostBreakdown({
      items: sheet(12, 12), partnerPricing: pricing, priority: "URGENT", adjustments: [],
    });
    assert.equal(normal.rushFee, 0);
    assert.equal(urgent.rushFee, 0.25); // 10% of 2.50
    assert.equal(urgent.subtotal, 2.75);
  });

  it("adds the special-ink fee only when an adjustment names it", () => {
    const without = computePartnerCostBreakdown({
      items: sheet(12, 12), partnerPricing: pricing, priority: null, adjustments: [],
    });
    const with_ = computePartnerCostBreakdown({
      items: sheet(12, 12), partnerPricing: pricing, priority: null,
      adjustments: [{ reason: "Special ink — metallic" }],
    });
    assert.equal(without.specialInkFee, 0);
    assert.equal(with_.specialInkFee, 5);
    assert.equal(with_.subtotal, 7.5);
  });
});

describe("computePartnerCostBreakdown — degenerate input", () => {
  it("returns zero rather than NaN for items with no dimensions", () => {
    const r = computePartnerCostBreakdown({
      items: [{ quantity: 2, unitPrice: 10 }],
      partnerPricing: { baseRatePerSqFt: 2.5 },
      priority: null,
      adjustments: [],
    });
    assert.equal(r.totalSqFt, 0);
    assert.equal(r.subtotal, 0);
  });

  it("ignores non-finite and negative dimensions", () => {
    const r = computePartnerCostBreakdown({
      items: [
        { widthIn: -5, heightIn: 10, quantity: 1 },
        { widthIn: 12, heightIn: 12, quantity: 1 },
      ],
      partnerPricing: { baseRatePerSqFt: 2.5 },
      priority: null,
      adjustments: [],
    });
    assert.equal(r.totalSqFt, 1);
  });
});
