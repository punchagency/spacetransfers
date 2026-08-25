import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PACKAGING_PROFILE,
  deriveParcel,
  normalizePackagingProfile,
} from "../services/packaging.service.js";
import { applyMarkup } from "../services/shipping.service.js";
import { normalizeGlobalPricing, totalBillableSqFt } from "../services/pricing.service.js";

/**
 * Every ShipStation order used to be declared as 1lb / 12x10x2in, whatever it
 * actually was. Rating against that produces a confident number for a parcel
 * that does not exist, and carriers re-bill the difference on the label.
 */

describe("parcel derivation — the declared parcel tracks the real one", () => {
  it("grows the weight with the area", () => {
    const small = deriveParcel(1, DEFAULT_PACKAGING_PROFILE);
    const large = deriveParcel(78, DEFAULT_PACKAGING_PROFILE);
    assert.ok(large.weightLb > small.weightLb, "78 sq ft must not weigh the same as 1 sq ft");
    // The old code declared 1lb for both of these.
    assert.notEqual(small.weightLb, large.weightLb);
  });

  it("picks the band the area falls in, smallest first", () => {
    const profile = normalizePackagingProfile({
      weightPerSqFtLb: 0,
      bands: [
        { maxSqFt: null, lengthIn: 30, widthIn: 9, heightIn: 9, tareLb: 1 },
        { maxSqFt: 5, lengthIn: 10, widthIn: 4, heightIn: 4, tareLb: 0.2 },
        { maxSqFt: 20, lengthIn: 20, widthIn: 6, heightIn: 6, tareLb: 0.5 },
      ],
    });
    assert.equal(deriveParcel(3, profile).lengthIn, 10);
    assert.equal(deriveParcel(12, profile).lengthIn, 20);
    assert.equal(deriveParcel(60, profile).lengthIn, 30, "open-ended band catches the rest");
  });

  it("treats a band boundary as inclusive of the smaller band", () => {
    const profile = normalizePackagingProfile({
      weightPerSqFtLb: 0,
      bands: [
        { maxSqFt: 6, lengthIn: 10, widthIn: 4, heightIn: 4, tareLb: 0 },
        { maxSqFt: null, lengthIn: 30, widthIn: 9, heightIn: 9, tareLb: 0 },
      ],
    });
    assert.equal(deriveParcel(6, profile).lengthIn, 10);
    assert.equal(deriveParcel(6.01, profile).lengthIn, 30);
  });

  it("rounds weight up, because carriers round against you", () => {
    const profile = normalizePackagingProfile({
      weightPerSqFtLb: 0.081,
      bands: [{ maxSqFt: null, lengthIn: 10, widthIn: 4, heightIn: 4, tareLb: 0 }],
    });
    // 3 x 0.081 = 0.243 -> 0.25, not 0.24
    assert.equal(deriveParcel(3, profile).weightLb, 0.25);
  });

  it("never declares a weightless parcel", () => {
    const profile = normalizePackagingProfile({
      weightPerSqFtLb: 0,
      bands: [{ maxSqFt: null, lengthIn: 10, widthIn: 4, heightIn: 4, tareLb: 0 }],
    });
    assert.ok(deriveParcel(0, profile).weightLb >= 0.1, "a carrier rejects a 0lb parcel");
  });

  it("keeps the open-ended band rather than coercing null to a number", () => {
    const p = normalizePackagingProfile({
      bands: [{ maxSqFt: null, lengthIn: 26, widthIn: 9, heightIn: 9, tareLb: 1 }],
    });
    assert.equal(p.bands[0].maxSqFt, null);
  });

  it("falls back to the default profile when every band is unusable", () => {
    const p = normalizePackagingProfile({
      bands: [{ maxSqFt: 5, lengthIn: -1, widthIn: 0, heightIn: "x", tareLb: null }],
    });
    assert.deepEqual(p.bands, DEFAULT_PACKAGING_PROFILE.bands);
  });
});

describe("markup", () => {
  it("adds a percentage of the carrier's price", () => {
    assert.equal(applyMarkup(40, 10), 44);
    assert.equal(applyMarkup(8.4, 10), 9.24);
  });

  it("is a no-op at zero", () => {
    assert.equal(applyMarkup(12.34, 0), 12.34);
  });

  it("recovers less on a cheap parcel than a flat fee would — by design, worth knowing", () => {
    // A tube costs the same either way; 10% of a $6 parcel is 60c.
    assert.equal(applyMarkup(6, 10), 6.6);
  });

  it("rounds to the cent", () => {
    assert.equal(applyMarkup(9.99, 7.5), 10.74);
  });
});

describe("parcel sizing uses the billed area", () => {
  it("sums area across lines and quantities", () => {
    const items = [
      { type: "gangsheet", widthIn: 12, heightIn: 12, quantity: 2 }, // 1 sq ft each
      { type: "gangsheet", widthIn: 24, heightIn: 24, quantity: 1 }, // 4 sq ft
    ];
    assert.equal(totalBillableSqFt(items), 6);
  });

  it("ignores lines with no usable dimensions rather than throwing", () => {
    // Sizing a parcel must not fail the way pricing does — pricing rejects
    // these separately, and with a clearer message.
    assert.equal(totalBillableSqFt([{ type: "gangsheet", quantity: 1 }]), 0);
  });
});

describe("global pricing keeps the shipping settings", () => {
  it("defaults the markup and packaging when absent", () => {
    const p = normalizeGlobalPricing({});
    assert.equal(p.shippingMarkupPct, 10);
    assert.ok(p.packaging.bands.length > 0);
  });

  it("keeps a configured markup", () => {
    assert.equal(normalizeGlobalPricing({ shippingMarkupPct: 17.5 }).shippingMarkupPct, 17.5);
  });

  it("keeps an explicit zero markup rather than substituting the default", () => {
    assert.equal(normalizeGlobalPricing({ shippingMarkupPct: 0 }).shippingMarkupPct, 0);
  });

  it("keeps the flat rates, which are now the fallback", () => {
    const p = normalizeGlobalPricing({ shipping: { standard: 7.5, express: 19.99 } });
    assert.equal(p.shipping.standard, 7.5);
    assert.equal(p.shipping.express, 19.99);
  });
});
