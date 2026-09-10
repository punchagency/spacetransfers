import { Order } from "../models/order.model.js";
import { isStripeConfigured, stripe } from "./stripe.service.js";

/**
 * Proof that an order was actually paid for.
 *
 * `createOrder` checked only that `payment.paymentIntentId` was a non-empty
 * string and then stored the client's payment object verbatim. Stripe was never
 * consulted, so any authenticated customer could place an order by inventing an
 * id:
 *
 *   payment: { method: "card", paymentIntentId: "pi_totally_made_up_1789…" }
 *   -> 201, DTF-0269, $46.00, PENDING, queued for a partner to print.
 *
 * Pricing was already safe — the server reprices every line and ignores the
 * client's figures — so the exploit could not choose its own price. It could
 * simply not pay at all.
 *
 * Five things have to hold, and each has its own failure:
 *   1. Stripe is configured        — otherwise nothing can be verified
 *   2. the intent exists           — not an invented id
 *   3. it succeeded                — not `requires_payment_method`, not canceled
 *   4. it covers the order total   — not a $0.50 intent against a $46 order
 *   5. it belongs to this customer — not someone else's receipt
 *   6. it has not been spent       — one payment cannot buy two orders
 */

export interface VerifiedPayment {
  paymentIntentId: string;
  amountReceivedCents: number;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
}

const badRequest = (message: string, statusCode = 400, code?: string) => {
  const error = new Error(message) as Error & { statusCode?: number; code?: string };
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

/**
 * A message a customer can act on, without naming our internals.
 *
 * "Your card was not charged" matters: the common cause is an intent that never
 * completed, and someone whose order failed needs to know whether to expect a
 * refund before they try again.
 */
const NOT_PAID =
  "We could not confirm your payment, so the order was not placed. Your card has not been charged — please try again.";

/**
 * Stripe and the order lookup are injectable.
 *
 * Not for its own sake: these are the money paths, and with no Stripe key
 * configured the only reachable branch is the "not configured" guard — every
 * other check would go untested. The defaults are the real thing, so callers
 * pass nothing.
 */
export interface PaymentVerificationDeps {
  configured: () => boolean;
  retrieveIntent: (id: string) => Promise<any>;
  findOrderByIntent: (id: string) => Promise<{ displayId?: string } | null>;
}

const defaultDeps: PaymentVerificationDeps = {
  configured: isStripeConfigured,
  retrieveIntent: (id) => stripe.paymentIntents.retrieve(id),
  findOrderByIntent: (id) =>
    Order.findOne({ "payment.paymentIntentId": id }).select("_id displayId").lean() as any,
};

export const verifyCardPayment = async ({
  paymentIntentId,
  expectedTotal,
  currency,
  userId,
  deps = defaultDeps,
}: {
  paymentIntentId: unknown;
  /** The server's own total. Never the client's. */
  expectedTotal: number;
  currency: string;
  userId: string;
  deps?: PaymentVerificationDeps;
}): Promise<VerifiedPayment> => {
  const id = typeof paymentIntentId === "string" ? paymentIntentId.trim() : "";
  if (!id) throw badRequest("payment.paymentIntentId is required for card payments");

  /*
   * Refused outright rather than waved through. With no key we cannot tell a
   * real payment from an invented one, and accepting the unverifiable is the
   * whole bug — an unconfigured Stripe must stop orders, not stop checking.
   */
  if (!deps.configured()) {
    throw badRequest(
      "Card payments are not available at the moment, so this order was not placed. Please try again shortly.",
      503,
      "STRIPE_NOT_CONFIGURED",
    );
  }

  /*
   * Checked before Stripe: a replay is cheap to detect and there is no reason
   * to spend a round trip on one. The unique index on `payment.paymentIntentId`
   * is what closes the race between two requests arriving together; this is the
   * check that produces a sensible message for the ordinary case.
   */
  const alreadySpent = await deps.findOrderByIntent(id);
  if (alreadySpent) {
    throw badRequest(
      "This payment has already been used for another order.",
      409,
      "PAYMENT_ALREADY_USED",
    );
  }

  let intent: any;
  try {
    intent = await deps.retrieveIntent(id);
  } catch (err: any) {
    // An id Stripe has never issued. Logged in full; the caller is told only
    // that it could not be confirmed.
    console.warn(`[payment] could not retrieve intent ${id}: ${err?.message}`);
    throw badRequest(NOT_PAID);
  }

  if (!intent || intent.status !== "succeeded") {
    console.warn(`[payment] intent ${id} is ${intent?.status ?? "missing"}, not succeeded`);
    throw badRequest(NOT_PAID);
  }

  /*
   * The order's own total, computed server-side, converted the same way the
   * intent was created. A one-cent tolerance absorbs rounding between the quote
   * that created the intent and the order that consumes it; anything larger is
   * a mismatch worth refusing.
   */
  const expectedCents = Math.round(expectedTotal * 100);
  const received = Number(intent.amount_received ?? 0);
  if (received + 1 < expectedCents) {
    console.warn(
      `[payment] intent ${id} paid ${received} but the order totals ${expectedCents}`,
    );
    throw badRequest(
      "The payment does not cover the order total, so the order was not placed.",
      400,
      "PAYMENT_AMOUNT_MISMATCH",
    );
  }

  if (String(intent.currency || "").toLowerCase() !== String(currency || "").toLowerCase()) {
    console.warn(`[payment] intent ${id} is ${intent.currency}, order is ${currency}`);
    throw badRequest(NOT_PAID);
  }

  /*
   * `metadata.userId` is stamped when the intent is created, so a receipt from
   * one account cannot be presented by another.
   *
   * Only enforced when the metadata is present: an intent created before this
   * was stamped has no userId, and refusing those would reject legitimate
   * in-flight checkouts on deploy.
   */
  const intentUser = String(intent.metadata?.userId || "");
  if (intentUser && intentUser !== String(userId)) {
    console.warn(`[payment] intent ${id} belongs to ${intentUser}, not ${userId}`);
    throw badRequest(NOT_PAID, 403);
  }

  const card = intent.charges?.data?.[0]?.payment_method_details?.card ?? null;
  return {
    paymentIntentId: id,
    amountReceivedCents: received,
    currency: String(intent.currency || currency).toUpperCase(),
    cardBrand: card?.brand ? String(card.brand) : null,
    cardLast4: card?.last4 ? String(card.last4) : null,
  };
};
