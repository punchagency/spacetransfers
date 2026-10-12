import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cancelOrderWithRefund, cancellationError, type CancellationDeps } from "../services/orderCancellation.service.js";

const ACTOR = { id: "a1", name: "Admin" };
const order = (over: any = {}) => ({
  _id: "o1",
  status: "PROCESSING",
  pricing: { total: 28.24 },
  payment: { method: "card", paymentIntentId: "pi_1" },
  ...over,
});
const deps = (over: Partial<CancellationDeps> = {}) => {
  const saved: any[] = [];
  const refunds: string[] = [];
  const d: CancellationDeps = {
    stripeConfigured: () => true,
    refund: async (pi, _orderId, cents) => {
      refunds.push(pi);
      return { id: "re_1", amount: cents / 100 };
    },
    save: async (_id, update) => {
      saved.push(update);
    },
    ...over,
  };
  return { d, saved, refunds };
};

describe("cancelling an order", () => {
  it("is allowed only before the order ships", () => {
    for (const s of ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"]) assert.equal(cancellationError(s), null, s);
    for (const s of ["SHIPPED", "COMPLETED", "CANCELLED"]) assert.equal(typeof cancellationError(s), "string", s);
  });

  it("refunds the payment, then cancels and records both", async () => {
    const { d, saved, refunds } = deps();
    const result = await cancelOrderWithRefund(order(), ACTOR, "Customer asked", d);
    assert.deepEqual(refunds, ["pi_1"]);
    assert.deepEqual(result, { refunded: true, refundAmount: 28.24, refundId: "re_1", noRefundReason: null, partnerPaid: false });
    assert.equal(saved[0].$set.status, "CANCELLED");
    assert.equal(saved[0].$set["payment.refundedAmount"], 28.24);
    assert.match(saved[0].$push.statusTimeline.message, /Cancelled and refunded \$28\.24: Customer asked/);
  });

  it("does not cancel when Stripe refuses the refund", async () => {
    const { d, saved } = deps({ refund: async () => { throw new Error("charge already refunded"); } });
    await assert.rejects(cancelOrderWithRefund(order(), ACTOR, "x", d), (e: any) => e.statusCode === 502 && /was not cancelled/.test(e.message));
    assert.equal(saved.length, 0);
  });

  it("cancels an order with no real payment without calling Stripe", async () => {
    const { d, saved, refunds } = deps();
    const result = await cancelOrderWithRefund(order({ payment: { method: "card", paymentIntentId: "mock_txn_1" } }), ACTOR, "Test order", d);
    assert.equal(refunds.length, 0);
    assert.equal(result.refunded, false);
    assert.equal(saved[0].$set.status, "CANCELLED");
  });

  it("pays the partner only when asked, and only for a job they had started", async () => {
    const started = order({ status: "PRINTING", assignedPrinter: "p1" });
    const a = deps();
    const paid = await cancelOrderWithRefund(started, ACTOR, "Customer changed their mind", a.d, { payPartner: true });
    assert.equal(paid.partnerPaid, true);
    assert.equal(a.saved[0].$set.cancellation.partnerPaid, true);
    assert.match(a.saved[0].$push.statusTimeline.message, /partner is still paid/);

    const b = deps();
    assert.equal((await cancelOrderWithRefund(started, ACTOR, "x", b.d)).partnerPaid, false);
    // Not started (or nobody assigned): there is no work to pay for.
    const c = deps();
    const notStarted = order({ status: "PROCESSING", assignedPrinter: "p1" });
    assert.equal((await cancelOrderWithRefund(notStarted, ACTOR, "x", c.d, { payPartner: true })).partnerPaid, false);
  });

  it("refunds only the amount chosen, and says how much was kept", async () => {
    const { d, saved } = deps();
    const result = await cancelOrderWithRefund(order(), ACTOR, "Printing had started", d, { refundAmount: 20 });
    assert.equal(result.refundAmount, 20);
    assert.equal(saved[0].$set["payment.refundedAmount"], 20);
    assert.equal(saved[0].$push["payment.refunds"].amount, 20);
    assert.match(saved[0].$push.statusTimeline.message, /refunded \$20\.00 of \$28\.24/);
  });

  it("cancels without a refund when the amount chosen is zero", async () => {
    const { d, saved, refunds } = deps();
    const result = await cancelOrderWithRefund(order(), ACTOR, "Abuse", d, { refundAmount: 0 });
    assert.equal(refunds.length, 0);
    assert.equal(result.refunded, false);
    assert.match(saved[0].$push.statusTimeline.message, /Cancelled without a refund/);
  });

  it("refunds what is left when part was refunded earlier, and never more", async () => {
    const part = order({ payment: { method: "card", paymentIntentId: "pi_1", refundedAmount: 8.24, refunds: [{ id: "re_0", amount: 8.24 }] } });
    const { d, saved } = deps();
    const result = await cancelOrderWithRefund(part, ACTOR, "Customer asked", d);
    assert.equal(result.refundAmount, 20);
    assert.equal(saved[0].$set["payment.refundedAmount"], 28.24);
    await assert.rejects(cancelOrderWithRefund(part, ACTOR, "x", deps().d, { refundAmount: 25 }), (e: any) => e.statusCode === 400 && /\$20\.00/.test(e.message));
    await assert.rejects(cancelOrderWithRefund(part, ACTOR, "x", deps().d, { refundAmount: -1 }), (e: any) => e.statusCode === 400);
  });

  it("needs a reason, and refuses shipped orders", async () => {
    const { d } = deps();
    await assert.rejects(cancelOrderWithRefund(order(), ACTOR, "  ", d), (e: any) => e.statusCode === 400);
    await assert.rejects(cancelOrderWithRefund(order({ status: "SHIPPED" }), ACTOR, "late", d), (e: any) => e.statusCode === 409);
  });
});
