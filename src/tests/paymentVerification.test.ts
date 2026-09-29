import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  verifyCardPayment,
  type PaymentVerificationDeps,
} from "../services/paymentVerification.service.js";

/**
 * An order could be placed without paying for it.
 *
 * `createOrder` required `payment.paymentIntentId` to be a non-empty string and
 * then stored the client's payment object verbatim. Stripe was never asked
 * whether the id meant anything, so this was enough:
 *
 *   payment: { method: "card", paymentIntentId: "pi_totally_made_up_1789…" }
 *   -> 201, DTF-0269, $46.00, PENDING, queued for a partner to print.
 *
 * Pricing was never the weakness — the server reprices every line and ignores
 * whatever the request claims — so the hole could not be used to choose a price.
 * It could be used to pay nothing at all.
 */

const USER = "6a83004ae0d5b5d73e3372b7";

/** A succeeded $46.00 intent belonging to USER. */
const goodIntent = {
  id: "pi_real",
  status: "succeeded",
  amount_received: 4600,
  currency: "usd",
  metadata: { userId: USER },
  // The shape Stripe returns today (API 2022-11-15 on): the card is on the
  // expanded `latest_charge`. This fixture used the retired `charges` list,
  // which is why the test passed while no real order ever recorded its card.
  latest_charge: { payment_method_details: { card: { brand: "visa", last4: "4242" } } },
};

const deps = (over: Partial<PaymentVerificationDeps> = {}): PaymentVerificationDeps => ({
  configured: () => true,
  retrieveIntent: async () => goodIntent,
  findOrderByIntent: async () => null,
  ...over,
});

const verify = (over: Partial<PaymentVerificationDeps> = {}, total = 46) =>
  verifyCardPayment({
    paymentIntentId: "pi_real",
    expectedTotal: total,
    currency: "USD",
    userId: USER,
    deps: deps(over),
  });

const rejects = async (promise: Promise<unknown>, status: number, why: string) => {
  await assert.rejects(promise, (e: any) => e?.statusCode === status, why);
};

describe("card payment verification", () => {
  it("accepts a succeeded intent that covers the order", async () => {
    const result = await verify();
    assert.equal(result.paymentIntentId, "pi_real");
    assert.equal(result.amountReceivedCents, 4600);
    assert.equal(result.cardLast4, "4242");
    assert.equal(result.cardBrand, "visa");
  });

  it("refuses an id Stripe has never issued", async () => {
    // The exploit: any string at all was accepted before.
    await rejects(
      verify({ retrieveIntent: async () => { throw new Error("No such payment_intent"); } }),
      400,
      "an invented id must not buy an order",
    );
  });

  it("refuses an intent that has not succeeded", async () => {
    for (const status of ["requires_payment_method", "requires_confirmation", "processing", "canceled"]) {
      await rejects(
        verify({ retrieveIntent: async () => ({ ...goodIntent, status }) }),
        400,
        `${status} is not payment`,
      );
    }
  });

  it("refuses an intent that does not cover the total", async () => {
    // A $0.50 intent against a $46 order.
    await rejects(
      verify({ retrieveIntent: async () => ({ ...goodIntent, amount_received: 50 }) }),
      400,
      "underpayment must not complete",
    );
  });

  it("tolerates a cent of rounding between the quote and the order", async () => {
    const result = await verify({
      retrieveIntent: async () => ({ ...goodIntent, amount_received: 4599 }),
    });
    assert.equal(result.amountReceivedCents, 4599);
  });

  it("accepts an overpayment rather than failing the customer", async () => {
    // Refusing here would take the money and refuse the goods.
    const result = await verify({
      retrieveIntent: async () => ({ ...goodIntent, amount_received: 5000 }),
    });
    assert.equal(result.amountReceivedCents, 5000);
  });

  it("refuses another customer's payment", async () => {
    await rejects(
      verify({ retrieveIntent: async () => ({ ...goodIntent, metadata: { userId: "someone-else" } }) }),
      403,
      "a receipt is not transferable",
    );
  });

  it("still accepts an intent with no userId stamped on it", async () => {
    // In-flight checkouts predating the metadata must not be rejected on deploy.
    const result = await verify({
      retrieveIntent: async () => ({ ...goodIntent, metadata: {} }),
    });
    assert.equal(result.paymentIntentId, "pi_real");
  });

  it("refuses a currency that is not the order's", async () => {
    await rejects(
      verify({ retrieveIntent: async () => ({ ...goodIntent, currency: "ngn" }) }),
      400,
      "a cheaper currency is not payment",
    );
  });

  it("refuses a payment already spent on another order", async () => {
    await rejects(
      verify({ findOrderByIntent: async () => ({ displayId: "DTF-0241" }) }),
      409,
      "one payment cannot buy two orders",
    );
  });

  it("refuses everything when Stripe is not configured", async () => {
    // The unverifiable is refused, not waved through — that was the bug.
    await rejects(verify({ configured: () => false }), 503, "cannot verify, so cannot accept");
  });

  it("refuses a missing or blank id before calling out", async () => {
    let called = false;
    const spy = deps({ retrieveIntent: async () => { called = true; return goodIntent; } });
    for (const id of [undefined, null, "", "   ", 12345]) {
      await assert.rejects(
        verifyCardPayment({ paymentIntentId: id, expectedTotal: 46, currency: "USD", userId: USER, deps: spy }),
        (e: any) => e?.statusCode === 400,
      );
    }
    assert.equal(called, false, "a blank id should not reach Stripe");
  });

  it("never reports our internals to the caller", async () => {
    await assert.rejects(
      verify({ retrieveIntent: async () => { throw new Error("Invalid API Key sk_live_abc123"); } }),
      (e: any) => !/sk_live|API Key|Stripe/i.test(String(e?.message)),
    );
  });
});
