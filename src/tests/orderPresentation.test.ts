import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTotals, DEFAULT_GLOBAL_PRICING } from "../services/pricing.service.js";
import { customerOrderStatus, formatSheetSize, orderChargeLines } from "../utils/orderPresentation.js";

const sum = (lines: { amount: number }[]) => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

describe("order presentation", () => {
  it("never shows a customer an internal status code", () => {
    assert.equal(customerOrderStatus("QUALITY_CHECK"), "Processing");
    assert.equal(customerOrderStatus("PRINTING"), "Processing");
    assert.equal(customerOrderStatus("PENDING"), "Pending");
    assert.equal(customerOrderStatus("SHIPPED"), "Shipped");
    assert.equal(customerOrderStatus("COMPLETED"), "Completed");
    assert.equal(customerOrderStatus("CANCELLED"), "Cancelled");
  });

  it("formats sheet sizes to one decimal", () => {
    assert.equal(formatSheetSize(23.5, 19.21333), '23.5" × 19.2"');
    assert.equal(formatSheetSize(0, 12), null);
  });

  it("lists every charge on an Express order, so the lines add up to the total", () => {
    const pricing = computeTotals({
      subtotal: 6.86,
      shippingMethod: "express",
      pricing: DEFAULT_GLOBAL_PRICING,
      shippingCost: 24.99,
      priority: "URGENT",
    });
    const lines = orderChargeLines({ shippingMethod: "express", pricing });
    assert.deepEqual(
      lines.map((l) => l.label),
      ["Subtotal", "Rush production", "Express shipping", "Tax"],
    );
    assert.equal(sum(lines), pricing.total);
  });

  it("omits the rush line on a standard order", () => {
    const lines = orderChargeLines({
      shippingMethod: "standard",
      pricing: { subtotal: 6.86, rushSurcharge: 0, shippingCost: 8.99, tax: 0.55, total: 16.4 },
    });
    assert.deepEqual(lines.map((l) => l.label), ["Subtotal", "Standard shipping", "Tax"]);
    assert.equal(sum(lines), 16.4);
  });

  it("includes admin adjustments, discounts and credits as negatives", () => {
    const lines = orderChargeLines({
      shippingMethod: "standard",
      pricing: {
        subtotal: 20,
        shippingCost: 8.99,
        tax: 1.6,
        total: 25.59,
        adjustments: [
          { type: "discount", amount: 5, reason: "Late delivery" },
          { type: "fee", amount: 0, reason: "" },
        ],
      },
    });
    assert.deepEqual(lines.slice(3).map((l) => [l.label, l.amount]), [
      ["Discount (Late delivery)", -5],
      ["Fee", 0],
    ]);
    assert.equal(sum(lines), 25.59);
  });
});
