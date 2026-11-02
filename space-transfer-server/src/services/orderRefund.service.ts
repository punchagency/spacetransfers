import { Order } from "../models/order.model.js";
import { isStripeConfigured, stripe } from "./stripe.service.js";

/**
 * Refunding an order's payment, in part or in full, without cancelling it.
 *
 * A late parcel, a damaged sheet, a goodwill gesture: the order stands, the
 * customer gets some or all of their money back. Stripe is asked first and the
 * order is updated only once it has accepted, so the record never claims a
 * refund that was not made. Each refund is kept, so several part refunds add
 * up and can never exceed what was paid.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** Whether the order was paid by a card charge Stripe can refund. */
export const hasRefundablePayment = (order: any): boolean => /^pi_/.test(String(order?.payment?.paymentIntentId || ""));

/** What is still left of the payment to refund, in dollars. */
export const refundableAmount = (order: any): number => {
  if (!hasRefundablePayment(order)) return 0;
  const paid = Number(order?.pricing?.total) || 0;
  const refunded = Number(order?.payment?.refundedAmount) || 0;
  return Math.max(0, round2(paid - refunded));
};

/** Why this refund can't be made, or null when it can. */
export const refundError = (order: any, amount: unknown, reason: unknown): string | null => {
  if (!hasRefundablePayment(order)) return "This order has no card payment on record, so there is nothing to refund.";
  const left = refundableAmount(order);
  if (left <= 0) return "This order has already been refunded in full.";
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "Enter a refund amount greater than zero.";
  if (round2(value) !== value) return "Enter the refund amount in dollars and cents.";
  if (value > left) return `The most that can be refunded on this order is $${left.toFixed(2)}.`;
  if (!String(reason || "").trim()) return "A reason is required for a refund.";
  return null;
};

export interface RefundDeps {
  stripeConfigured: () => boolean;
  /** Refunds `cents` of the payment. `key` makes a repeated request return the same refund. */
  refund: (paymentIntentId: string, cents: number, orderId: string, key: string) => Promise<{ id: string; amount: number }>;
  save: (orderId: string, update: Record<string, unknown>) => Promise<void>;
}

export const defaultRefundDeps: RefundDeps = {
  stripeConfigured: isStripeConfigured,
  refund: async (paymentIntentId, cents, orderId, key) => {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: cents, reason: "requested_by_customer", metadata: { orderId } },
      { idempotencyKey: key },
    );
    return { id: refund.id, amount: Math.round(refund.amount) / 100 };
  },
  save: async (orderId, update) => {
    await Order.updateOne({ _id: orderId }, update);
  },
};

/**
 * The key for an order's next refund. It names how many refunds came before
 * and the amount, so a double click returns the refund already made, while a
 * deliberate second refund of the same amount later is a new one.
 */
export const refundIdempotencyKey = (order: any, cents: number) =>
  `order-refund-${String(order?._id)}-${Array.isArray(order?.payment?.refunds) ? order.payment.refunds.length : 0}-${cents}`;

export interface RefundResult {
  refundId: string;
  /** This refund, in dollars. */
  amount: number;
  totalRefunded: number;
  /** What is left that could still be refunded. */
  remaining: number;
  /** True when nothing is left of the payment. */
  full: boolean;
}

/** What a refund adds to the order record. Shared with cancellation, which refunds too. */
export const refundRecord = (
  order: any,
  refund: { id: string; amount: number },
  actor: { id: string; name: string },
  reason: string,
  at: Date,
) => {
  const totalRefunded = round2((Number(order?.payment?.refundedAmount) || 0) + refund.amount);
  return {
    totalRefunded,
    set: {
      "payment.refundId": refund.id,
      "payment.refundedAmount": totalRefunded,
      "payment.refundedAt": at,
    },
    push: { id: refund.id, amount: refund.amount, reason, at, byId: actor.id, byName: actor.name },
  };
};

export const refundOrderPayment = async (
  order: any,
  actor: { id: string; name: string },
  request: { amount: unknown; reason: unknown },
  deps: RefundDeps = defaultRefundDeps,
): Promise<RefundResult> => {
  const refusal = refundError(order, request.amount, request.reason);
  if (refusal) throw httpError(refusal, 400);
  if (!deps.stripeConfigured()) throw httpError("Stripe isn't configured, so the refund can't be made.", 503);

  const amount = Number(request.amount);
  const reason = String(request.reason).trim();
  const cents = Math.round(amount * 100);
  let refund: { id: string; amount: number };
  try {
    refund = await deps.refund(String(order.payment.paymentIntentId), cents, String(order._id), refundIdempotencyKey(order, cents));
  } catch (err: any) {
    throw httpError(`Stripe couldn't make this refund: ${err?.message || "unknown error"}`, 502);
  }

  const now = new Date();
  const paid = Number(order?.pricing?.total) || 0;
  const record = refundRecord(order, refund, actor, reason, now);
  const remaining = Math.max(0, round2(paid - record.totalRefunded));
  await deps.save(String(order._id), {
    $set: { ...record.set, updatedAt: now },
    $push: {
      "payment.refunds": record.push,
      statusTimeline: {
        // A refund does not move the order; the entry carries the status it has.
        status: String(order.status || "PENDING"),
        time: now,
        message:
          remaining <= 0
            ? `Refunded $${refund.amount.toFixed(2)}, the order is now refunded in full: ${reason}`
            : `Refunded $${refund.amount.toFixed(2)} of $${paid.toFixed(2)}: ${reason}`,
        actorRole: "ADMIN",
        actorId: actor.id,
        actorName: actor.name,
      },
    },
  });

  return { refundId: refund.id, amount: refund.amount, totalRefunded: record.totalRefunded, remaining, full: remaining <= 0 };
};
