import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cancelOrderWithRefund, cancellationError, type CancellationDeps } from "../services/orderCancellation.service.js";

const ACTOR = { id: "a1", name: "Admin" };
const order = (over: any = {}) => ({ _id: "o1", status: "PROCESSING", payment: { method: "card", paymentIntentId: "pi_1" }, ...over });
const deps = (over: Partial<CancellationDeps> = {}) => {
  const saved: any[] = [];
  const refunds: string[] = [];
  const d: CancellationDeps = {
    stripeConfigured: () => true,
    refund: async (pi) => {
      refunds.push(pi);
      return { id: "re_1", amount: 28.24 };
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
    assert.deepEqual(result, { refunded: true, refundAmount: 28.24, refundId: "re_1", noRefundReason: null });
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

  it("needs a reason, and refuses shipped orders", async () => {
    const { d } = deps();
    await assert.rejects(cancelOrderWithRefund(order(), ACTOR, "  ", d), (e: any) => e.statusCode === 400);
    await assert.rejects(cancelOrderWithRefund(order({ status: "SHIPPED" }), ACTOR, "late", d), (e: any) => e.statusCode === 409);
  });
});
