/**
 * A customer cancelling their own order, and the partner's answer.
 * Run with: npm test — no network, no database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cancellationBlocksPartner, cleanReason, customerCancellation } from "../services/cancellationRequest.service.js";
import { cancelOrderWithRefund } from "../services/orderCancellation.service.js";

describe("what a customer may do about cancelling", () => {
  it("cancels at once before a partner has the order", () => {
    assert.equal(customerCancellation({ status: "PENDING" }).option, "now");
  });

  it("asks the partner once one has it, until it ships", () => {
    for (const status of ["PROCESSING", "PRINTING", "QUALITY_CHECK"]) {
      assert.equal(customerCancellation({ status, assignedPrinter: "p1" }).option, "request", status);
    }
    for (const status of ["SHIPPED", "COMPLETED", "CANCELLED"]) {
      assert.equal(customerCancellation({ status, assignedPrinter: "p1" }).option, null, status);
    }
  });

  it("can't ask twice, or again after the partner said no, but can after withdrawing", () => {
    const base = { status: "PRINTING", assignedPrinter: "p1" };
    assert.equal(customerCancellation({ ...base, cancellationRequest: { status: "PENDING", requestedAt: new Date() } }).option, null);
    const declined = customerCancellation({ ...base, cancellationRequest: { status: "DECLINED", declineReason: "Already printed", requestedAt: new Date() } });
    assert.equal(declined.option, null);
    assert.equal(declined.request?.declineReason, "Already printed");
    const withdrawn = customerCancellation({ ...base, cancellationRequest: { status: "WITHDRAWN", requestedAt: new Date() } });
    assert.equal(withdrawn.option, "request");
    assert.equal(withdrawn.request, null);
  });

  it("holds the partner until they answer", () => {
    assert.match(cancellationBlocksPartner({ cancellationRequest: { status: "PENDING" } })!, /Accept or decline/);
    assert.equal(cancellationBlocksPartner({ cancellationRequest: { status: "DECLINED" } }), null);
    assert.equal(cancellationBlocksPartner({}), null);
  });

  it("needs a reason to decline, and keeps reasons short", () => {
    assert.equal(cleanReason("", false), "");
    assert.throws(() => cleanReason(" ", true), (e: any) => e.statusCode === 400);
    assert.equal(cleanReason("  Already on the press ", true), "Already on the press");
    assert.throws(() => cleanReason("x".repeat(501), false), (e: any) => e.statusCode === 400);
  });
});

describe("cancelling settles the customer's request", () => {
  const saved: any[] = [];
  const deps = {
    stripeConfigured: () => true,
    refund: async (_pi: string, _o: string, cents: number) => ({ id: "re_1", amount: cents }),
    save: async (_id: string, update: any) => void saved.push(update),
  };
  const order = {
    _id: "o1",
    status: "PRINTING",
    assignedPrinter: "p1",
    payment: { paymentIntentId: "pi_1" },
    pricing: { total: 20 },
    cancellationRequest: { status: "PENDING", requestedAt: new Date() },
  };

  it("marks the request accepted and records who cancelled", async () => {
    saved.length = 0;
    const result = await cancelOrderWithRefund(order, { id: "p1", name: "Inkworks" }, "Cancelled at the customer's request", deps, { actorRole: "PRINTER" });
    assert.equal(result.refunded, true);
    assert.equal(saved[0].$set["cancellationRequest.status"], "ACCEPTED");
    assert.equal(saved[0].$set["cancellationRequest.respondedByName"], "Inkworks");
    assert.equal(saved[0].$push.statusTimeline.actorRole, "PRINTER");
  });

  it("leaves orders without a request alone, and admins as the default actor", async () => {
    saved.length = 0;
    await cancelOrderWithRefund({ ...order, cancellationRequest: undefined }, { id: "a1", name: "Admin" }, "Out of stock", deps);
    assert.equal("cancellationRequest.status" in saved[0].$set, false);
    assert.equal(saved[0].$push.statusTimeline.actorRole, "ADMIN");
  });
});
