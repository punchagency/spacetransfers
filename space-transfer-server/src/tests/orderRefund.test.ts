import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  refundableAmount,
  refundError,
  refundIdempotencyKey,
  refundOrderPayment,
  type RefundDeps,
} from "../services/orderRefund.service.js";
import { computeOrderFinancials } from "../services/orderFinancials.service.js";
import { orderRefundNote } from "../utils/orderPresentation.js";

const ACTOR = { id: "a1", name: "Admin" };
const order = (over: any = {}) => ({
  _id: "o1",
  status: "SHIPPED",
  pricing: { subtotal: 17.82, rushSurcharge: 0, shippingCost: 8.99, tax: 1.43, total: 28.24 },
  payment: { method: "card", paymentIntentId: "pi_1", processingFee: 1.12 },
  ...over,
});
const deps = (over: Partial<RefundDeps> = {}) => {
  const saved: any[] = [];
  const calls: { cents: number; key: string }[] = [];
  const d: RefundDeps = {
    stripeConfigured: () => true,
    refund: async (_pi, cents, _orderId, key) => {
      calls.push({ cents, key });
      return { id: `re_${calls.length}`, amount: cents / 100 };
    },
    save: async (_id, update) => {
      saved.push(update);
    },
    ...over,
  };
  return { d, saved, calls };
};

describe("refunding an order", () => {
  it("knows what is left to refund", () => {
    assert.equal(refundableAmount(order()), 28.24);
    assert.equal(refundableAmount(order({ payment: { paymentIntentId: "pi_1", refundedAmount: 8.24 } })), 20);
    assert.equal(refundableAmount(order({ payment: { paymentIntentId: "pi_1", refundedAmount: 28.24 } })), 0);
    assert.equal(refundableAmount(order({ payment: { paymentIntentId: "mock_txn_1" } })), 0);
  });

  it("refuses amounts that are not real money or exceed what is left", () => {
    assert.equal(refundError(order(), 5, "Late"), null);
    assert.equal(refundError(order(), 28.24, "Late"), null);
    for (const bad of [0, -3, "abc", 5.005, 28.25]) assert.equal(typeof refundError(order(), bad, "Late"), "string", String(bad));
    assert.match(refundError(order(), 5, " ")!, /reason/);
    assert.match(refundError(order({ payment: { paymentIntentId: "mock_1" } }), 5, "x")!, /no card payment/);
    assert.match(refundError(order({ payment: { paymentIntentId: "pi_1", refundedAmount: 28.24 } }), 1, "x")!, /in full/);
  });

  it("refunds part of the payment and leaves the order where it was", async () => {
    const { d, saved, calls } = deps();
    const result = await refundOrderPayment(order(), ACTOR, { amount: 5, reason: "Arrived late" }, d);
    assert.deepEqual(result, { refundId: "re_1", amount: 5, totalRefunded: 5, remaining: 23.24, full: false });
    assert.equal(calls[0].cents, 500);
    assert.equal(saved[0].$set.status, undefined);
    assert.equal(saved[0].$set["payment.refundedAmount"], 5);
    assert.deepEqual(
      { ...saved[0].$push["payment.refunds"], at: null },
      { id: "re_1", amount: 5, reason: "Arrived late", at: null, byId: "a1", byName: "Admin" },
    );
    assert.equal(saved[0].$push.statusTimeline.status, "SHIPPED");
    assert.match(saved[0].$push.statusTimeline.message, /Refunded \$5\.00 of \$28\.24: Arrived late/);
  });

  it("adds a second refund to the first", async () => {
    const earlier = order({ payment: { paymentIntentId: "pi_1", refundedAmount: 5, refunds: [{ id: "re_1", amount: 5 }] } });
    const { d, saved } = deps();
    const result = await refundOrderPayment(earlier, ACTOR, { amount: 23.24, reason: "Damaged" }, d);
    assert.equal(result.totalRefunded, 28.24);
    assert.equal(result.full, true);
    assert.match(saved[0].$push.statusTimeline.message, /refunded in full/);
  });

  it("uses a key that repeats for a double click and changes for a later refund", () => {
    assert.equal(refundIdempotencyKey(order(), 500), refundIdempotencyKey(order(), 500));
    const later = order({ payment: { paymentIntentId: "pi_1", refunds: [{ id: "re_1", amount: 5 }] } });
    assert.notEqual(refundIdempotencyKey(order(), 500), refundIdempotencyKey(later, 500));
  });

  it("records nothing when Stripe refuses or is not set up", async () => {
    const refused = deps({ refund: async () => { throw new Error("insufficient funds"); } });
    await assert.rejects(refundOrderPayment(order(), ACTOR, { amount: 5, reason: "x" }, refused.d), (e: any) => e.statusCode === 502);
    assert.equal(refused.saved.length, 0);
    const off = deps({ stripeConfigured: () => false });
    await assert.rejects(refundOrderPayment(order(), ACTOR, { amount: 5, reason: "x" }, off.d), (e: any) => e.statusCode === 503);
    await assert.rejects(refundOrderPayment(order(), ACTOR, { amount: 50, reason: "x" }, deps().d), (e: any) => e.statusCode === 400);
  });
});

describe("refunds in the books", () => {
  const RATE = { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } };
  const sheets = [
    { type: "gangsheet", widthIn: 23.5, heightIn: 19.21, quantity: 1 },
    { type: "gangsheet", widthIn: 23.5, heightIn: 12, quantity: 1 },
  ];

  it("takes a refund on a standing order off the profit", () => {
    const before = computeOrderFinancials(order({ items: sheets }), RATE);
    const after = computeOrderFinancials(order({ items: sheets, payment: { paymentIntentId: "pi_1", processingFee: 1.12, refundedAmount: 5 } }), RATE);
    assert.equal(after.refunded, 5);
    assert.equal(after.profit, Math.round((before.profit! - 5) * 100) / 100);
  });

  it("keeps what was held back on a cancellation, less the card fee", () => {
    const f = computeOrderFinancials(
      order({ items: sheets, status: "CANCELLED", payment: { paymentIntentId: "pi_1", processingFee: 1.12, refundedAmount: 20 } }),
      RATE,
    );
    assert.equal(f.keptOnCancel, 8.24);
    assert.equal(f.profit, 7.12);
  });

  it("words the refund for the customer", () => {
    const at = new Date("2026-10-02T12:00:00Z");
    assert.equal(orderRefundNote(order()), null);
    assert.equal(orderRefundNote(order({ payment: { refundedAmount: 5, refundedAt: at } })), "$5.00 of $28.24 refunded on October 2, 2026.");
    assert.equal(orderRefundNote(order({ payment: { refundedAmount: 28.24, refundedAt: at } })), "Refunded in full ($28.24) on October 2, 2026.");
    assert.equal(
      orderRefundNote(order({ status: "CANCELLED", payment: { refundedAmount: 20, refundedAt: at } })),
      "Cancelled. $20.00 of $28.24 refunded on October 2, 2026.",
    );
    assert.equal(
      orderRefundNote(order({ status: "CANCELLED", payment: { refundedAmount: 28.24, refundedAt: at } })),
      "Cancelled. $28.24 refunded on October 2, 2026.",
    );
    assert.equal(orderRefundNote(order({ status: "CANCELLED", payment: {} })), "Cancelled. No payment was taken.");
    assert.equal(orderRefundNote(order({ status: "CANCELLED" })), "Cancelled. No refund was issued.");
  });
});
