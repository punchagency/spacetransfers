import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  billableAreaSqFt,
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
    assert.equal(deriveItemUnitPrice(item, pricing), 38.5);
    assert.equal(computeSubtotal([item], pricing), 38.5);
  });

  it("ignores an inflated unitPrice too", () => {
    const item = sheet(12, 12, { quantity: 1, unitPrice: 9999 });
    assert.equal(computeSubtotal([item], pricing), 3.5); // 1 sq ft
  });

  it("ignores a missing unitPrice entirely", () => {
    assert.equal(computeSubtotal([sheet(12, 12, { quantity: 1 })], pricing), 3.5);
  });

  it("prices the displayed area, matching what the cart showed", () => {
    // The editor rounds area to 2dp and prices that: 11.00 sq ft x 3.50.
    // Pricing the raw 11.002018 sq ft would charge 38.51 for a $38.50 cart.
    assert.equal(billableAreaSqFt(24.34, 65.09), 11);
    assert.equal(sheetUnitPrice(11, pricing), 38.5);
  });

  it("multiplies by a sanitised quantity", () => {
    assert.equal(computeSubtotal([sheet(12, 12, { quantity: 3 })], pricing), 10.5);
    // Fractional and negative quantities cannot buy a discount.
    assert.equal(itemQuantity({ quantity: 0 }), 1);
    assert.equal(itemQuantity({ quantity: -5 }), 1);
    assert.equal(itemQuantity({ quantity: 2.7 }), 2);
    assert.equal(itemQuantity({}), 1);
  });

  it("follows the admin's rate, not the price the client sent", () => {
    const dearer = normalizeGlobalPricing({ baseRatePerSqFt: 24 });
    const item = sheet(12, 12, { quantity: 1, unitPrice: 3.5 });
    assert.equal(computeSubtotal([item], dearer), 24);
  });

  it("sums several lines", () => {
    const items = [sheet(12, 12, { quantity: 2 }), sheet(24, 24, { quantity: 1 })];
    assert.equal(computeSubtotal(items, pricing), 7 + 14);
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
    rejects(sheet(0, 65), "zero width");
    rejects(sheet(65, 0), "zero height");
    rejects(sheet(-24, 65), "negative width");
    assert.equal(billableAreaSqFt(0, 65), null);
  });

  it("accepts numeric strings, which is what a form-encoded payload sends", () => {
    assert.equal(deriveItemUnitPrice({ type: "gangsheet", widthIn: "12", heightIn: "12" }, pricing), 3.5);
  });

  it("rejects missing and non-numeric dimensions", () => {
    rejects({ type: "gangsheet", name: "x", quantity: 1, unitPrice: 5 }, "no dimensions");
    rejects({ type: "gangsheet", widthIn: "wide", heightIn: 65 }, "non-numeric text");
    rejects({ type: "gangsheet", widthIn: Infinity, heightIn: 65 }, "infinite");
    rejects({ type: "gangsheet", widthIn: NaN, heightIn: 65 }, "NaN");
  });

  it("rejects an unknown item type instead of falling back to its price", () => {
    rejects({ type: "mug", name: "Mug", quantity: 1, unitPrice: 12 }, "unknown type");
  });

  it("rejects the whole subtotal if any single line cannot be priced", () => {
    const items = [sheet(12, 12, { quantity: 1 }), sheet(0, 0, { quantity: 1, unitPrice: 500 })];
    assert.throws(() => computeSubtotal(items, pricing), (e: any) => e?.statusCode === 400);
  });
});
