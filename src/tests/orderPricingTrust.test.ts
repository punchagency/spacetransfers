import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  billableSheetArea,
  computeSubtotal,
  deriveItemUnitPrice,
  itemQuantity,
  normalizeGlobalPricing,
  sheetUnitPrice,
} from "../services/pricing.service.js";

/**
 * The order payload used to carry its own prices. `createOrder` checked only
 * that the client's numbers agreed with each other, and the Stripe amount came
 * from the same `unitPrice` field — so a crafted request named what it paid.
 * These pin the prices to the sheet's dimensions instead.
 */

const pricing = normalizeGlobalPricing({
  baseRatePerSqFt: 3.5,
  shipping: { standard: 8.99, express: 24.99 },
  taxRatePct: 8,
});

const sheet = (widthIn: number, heightIn: number, extra: Record<string, unknown> = {}) => ({
  type: "gangsheet",
  name: "Gang Sheet",
  widthIn,
  heightIn,
  ...extra,
});

describe("order pricing — the client's unitPrice is not consulted", () => {
  it("ignores a understated unitPrice and charges the sheet's real price", () => {
    // A real order: 24.34 x 65.09in. The client claims it costs one cent.
    const item = sheet(24.34, 65.09, { quantity: 1, unitPrice: 0.01 });
    // 23.5in of roll x 65.09in long = 10.62 sq ft at 3.50.
    assert.equal(deriveItemUnitPrice(item, pricing), 37.17);
    assert.equal(computeSubtotal([item], pricing), 37.17);
  });

  it("ignores an inflated unitPrice too", () => {
    const item = sheet(12, 12, { quantity: 1, unitPrice: 9999 });
    assert.equal(computeSubtotal([item], pricing), 6.86); // 23.5 x 12in = 1.96 sq ft
  });

  it("ignores a missing unitPrice entirely", () => {
    assert.equal(computeSubtotal([sheet(12, 12, { quantity: 1 })], pricing), 6.86);
  });

  it("prices the displayed area, matching what the cart showed", () => {
    // Billed on the roll: 23.5 x 65.09in, rounded to 2dp before pricing.
    assert.equal(billableSheetArea(65.09, pricing), 10.62);
    assert.equal(sheetUnitPrice(10.62, pricing), 37.17);
  });

  it("multiplies by a sanitised quantity", () => {
    assert.equal(computeSubtotal([sheet(12, 12, { quantity: 3 })], pricing), 20.58);
    // Fractional and negative quantities cannot buy a discount.
    assert.equal(itemQuantity({ quantity: 0 }), 1);
    assert.equal(itemQuantity({ quantity: -5 }), 1);
    assert.equal(itemQuantity({ quantity: 2.7 }), 2);
    assert.equal(itemQuantity({}), 1);
  });

  it("follows the admin's rate, not the price the client sent", () => {
    const dearer = normalizeGlobalPricing({ baseRatePerSqFt: 24 });
    const item = sheet(12, 12, { quantity: 1, unitPrice: 3.5 });
    assert.equal(computeSubtotal([item], dearer), 47.04); // 1.96 sq ft x 24
  });

  it("sums several lines", () => {
    const items = [sheet(12, 12, { quantity: 2 }), sheet(24, 24, { quantity: 1 })];
    assert.equal(computeSubtotal(items, pricing), 13.72 + 13.72);
  });
});

describe("order pricing — a sheet with no area cannot be bought", () => {
  const rejects = (item: unknown, why: string) =>
    assert.throws(
      () => deriveItemUnitPrice(item, pricing),
      (e: any) => e?.statusCode === 400,
      why,
    );

  it("rejects zero and negative dimensions rather than pricing them at nothing", () => {
    // `mapItems` sends `widthIn: item.widthIn || 0`, so a zero is reachable —
    // and a zero-area sheet priced at 0 is an order placed for shipping alone.
    rejects(sheet(65, 0), "zero height");
    rejects(sheet(65, -5), "negative height");
    assert.equal(billableSheetArea(0, pricing), null);
    assert.equal(billableSheetArea(-5, pricing), null);
  });

  it("accepts numeric strings, which is what a form-encoded payload sends", () => {
    assert.equal(deriveItemUnitPrice({ type: "gangsheet", widthIn: "12", heightIn: "12" }, pricing), 6.86);
  });

  it("rejects missing and non-numeric dimensions", () => {
    rejects({ type: "gangsheet", name: "x", quantity: 1, unitPrice: 5 }, "no dimensions");
    rejects({ type: "gangsheet", widthIn: 23.5, heightIn: "long" }, "non-numeric text");
    rejects({ type: "gangsheet", widthIn: 23.5, heightIn: Infinity }, "infinite");
    rejects({ type: "gangsheet", widthIn: 23.5, heightIn: NaN }, "NaN");
  });

  it("rejects an unknown item type instead of falling back to its price", () => {
    rejects({ type: "mug", name: "Mug", quantity: 1, unitPrice: 12 }, "unknown type");
  });

  it("rejects the whole subtotal if any single line cannot be priced", () => {
    const items = [sheet(12, 12, { quantity: 1 }), sheet(23.5, 0, { quantity: 1, unitPrice: 500 })];
    assert.throws(() => computeSubtotal(items, pricing), (e: any) => e?.statusCode === 400);
  });
});

/**
 * A gang sheet is cut from a fixed roll and has a minimum run length. Neither
 * was implemented: price came from the bounding box of the artwork, so a sparse
 * sheet was billed a fraction of the roll it actually consumes.
 */
describe("order pricing — the roll, not the artwork's bounding box", () => {
  it("bills the full roll width however narrow the artwork is", () => {
    // One 6x10in graphic. The bounding box is 0.42 sq ft; the roll consumed is
    // 23.5 x 10in = 1.63 sq ft. It used to charge 1.47 instead of 5.71.
    assert.equal(deriveItemUnitPrice(sheet(6, 10, { quantity: 1 }), pricing), 5.71);
  });

  it("charges the same whatever width the client claims", () => {
    const asClaimed = (w: number) => deriveItemUnitPrice(sheet(w, 30, { quantity: 1 }), pricing);
    // Understating the width was a four-fold discount; now it buys nothing.
    assert.equal(asClaimed(1), asClaimed(23.5));
    assert.equal(asClaimed(0.01), asClaimed(500));
  });

  it("applies the minimum length to a short run", () => {
    const min = deriveItemUnitPrice(sheet(23.5, 10, { quantity: 1 }), pricing);
    assert.equal(deriveItemUnitPrice(sheet(23.5, 1, { quantity: 1 }), pricing), min);
    assert.equal(deriveItemUnitPrice(sheet(23.5, 9.99, { quantity: 1 }), pricing), min);
  });

  it("does not apply the minimum once the sheet is longer than it", () => {
    const atMin = deriveItemUnitPrice(sheet(23.5, 10, { quantity: 1 }), pricing);
    assert.ok(deriveItemUnitPrice(sheet(23.5, 20, { quantity: 1 }), pricing) > atMin);
  });

  it("takes both figures from the admin's settings rather than a constant", () => {
    const wider = normalizeGlobalPricing({ baseRatePerSqFt: 3.5, sheetWidthIn: 47, minSheetLengthIn: 10 });
    assert.equal(billableSheetArea(10, wider), 3.26); // 47 x 10 / 144
    const longerMin = normalizeGlobalPricing({ baseRatePerSqFt: 3.5, minSheetLengthIn: 24 });
    assert.equal(billableSheetArea(1, longerMin), billableSheetArea(24, longerMin));
  });

  it("defaults to a 23.5in roll and a 10in minimum when nothing is configured", () => {
    const defaults = normalizeGlobalPricing({});
    assert.equal(defaults.sheetWidthIn, 23.5);
    assert.equal(defaults.minSheetLengthIn, 10);
  });
});
