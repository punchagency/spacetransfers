import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeOrderFinancials, orderShippingCost } from "../services/orderFinancials.service.js";
import { stripeFeeOf } from "../services/paymentVerification.service.js";

const RATE = { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } };

// DTF-0276 as it stands on staging: two sheets, standard shipping at the flat rate.
const order = (over: any = {}) => ({
  status: "PENDING",
  priority: "NORMAL",
  items: [
    { type: "gangsheet", widthIn: 23.5, heightIn: 19.21, quantity: 1 },
    { type: "gangsheet", widthIn: 23.5, heightIn: 12, quantity: 1 },
  ],
  pricing: { subtotal: 17.82, rushSurcharge: 0, shippingCost: 8.99, tax: 1.43, total: 28.24, currency: "USD" },
  payment: { method: "card", paymentIntentId: "pi_x" },
  ...over,
});

describe("order financials", () => {
  it("does not count tax or shipping as profit", () => {
    const f = computeOrderFinancials(order(), RATE);
    assert.equal(f.partnerCost, 12.73);
    assert.equal(f.shippingCostSource, "at-cost");
    // 28.24 − 1.43 tax − 8.99 shipping − 12.73 partner = 5.09 (it was 15.51).
    assert.equal(f.profit, 5.09);
    assert.equal(f.processingFee, null);
  });

  it("takes the card fee off when it is recorded", () => {
    const f = computeOrderFinancials(order({ payment: { method: "card", processingFee: 1.12 } }), RATE);
    assert.equal(f.profit, 3.97);
  });

  it("keeps shipping markup: the label's real cost, else the carrier quote", () => {
    assert.deepEqual(orderShippingCost(order({ shipStationLabelCost: 6.4, shippingQuote: { carrierCost: 7 } })), { cost: 6.4, source: "label" });
    assert.deepEqual(orderShippingCost(order({ shippingQuote: { carrierCost: 7.5 } })), { cost: 7.5, source: "quote" });
    // 28.24 − 1.43 − 6.40 − 12.73 = 7.68: the 2.59 over the label is the business's.
    assert.equal(computeOrderFinancials(order({ shipStationLabelCost: 6.4 }), RATE).profit, 7.68);
  });

  it("has no profit, rather than a made-up one, when no partner cost can be derived", () => {
    const f = computeOrderFinancials(order({ items: [{ type: "gangsheet" }] }), RATE);
    assert.equal(f.partnerCost, null);
    assert.equal(f.profit, null);
  });

  it("counts a cancelled, refunded order as a loss of the card fee only", () => {
    const f = computeOrderFinancials(
      order({ status: "CANCELLED", payment: { method: "card", processingFee: 1.12, refundedAmount: 28.24 } }),
      RATE,
    );
    assert.equal(f.refunded, 28.24);
    assert.equal(f.profit, -1.12);
    // Cancelled after printing began, partner paid anyway: the loss includes their fee.
    const paid = computeOrderFinancials(
      order({ status: "CANCELLED", cancellation: { partnerPaid: true }, payment: { method: "card", processingFee: 1.12, refundedAmount: 28.24 } }),
      RATE,
    );
    assert.equal(paid.profit, -13.85);
    // Cancelled without any payment to refund: nothing gained, nothing lost.
    assert.equal(computeOrderFinancials(order({ status: "CANCELLED", payment: { method: "card" } }), RATE).profit, 0);
  });

  it("reads Stripe's fee from the charge's balance transaction, in dollars", () => {
    assert.equal(stripeFeeOf({ balance_transaction: { fee: 112 } }), 1.12);
    // Not settled yet: an id string, not an object — unknown, not zero.
    assert.equal(stripeFeeOf({ balance_transaction: "txn_123" }), null);
    assert.equal(stripeFeeOf(null), null);
  });
});
