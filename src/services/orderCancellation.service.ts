import { Order } from "../models/order.model.js";
import { isStripeConfigured, stripe } from "./stripe.service.js";

/**
 * Cancelling a customer's order, with its refund.
 *
 * Only an admin cancels an order. A partner who can't do a job hands it back to
 * the queue instead. The refund is made first and the order is cancelled only
 * once Stripe has accepted it, so an order is never cancelled while the
 * customer is still charged.
 */

/** Statuses an order can be cancelled from: anything before it ships. */
export const CANCELLABLE_STATUSES = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"] as const;

export const cancellationError = (status: unknown): string | null => {
  const s = String(status || "").toUpperCase();
  if (s === "CANCELLED") return "This order is already cancelled.";
  if (s === "SHIPPED" || s === "COMPLETED") return "This order has shipped, so it can't be cancelled here.";
  return (CANCELLABLE_STATUSES as readonly string[]).includes(s) ? null : "This order can't be cancelled.";
};

export interface CancellationDeps {
  stripeConfigured: () => boolean;
  /** Refunds the whole payment. Returns Stripe's refund id and the amount in dollars. */
  refund: (paymentIntentId: string, orderId: string) => Promise<{ id: string; amount: number }>;
  save: (orderId: string, update: Record<string, unknown>) => Promise<void>;
}

const defaultDeps: CancellationDeps = {
  stripeConfigured: isStripeConfigured,
  refund: async (paymentIntentId, orderId) => {
    // The key makes a repeated click return the same refund instead of a second one.
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { orderId } },
      { idempotencyKey: `order-cancel-${orderId}` },
    );
    return { id: refund.id, amount: Math.round(refund.amount) / 100 };
  },
  save: async (orderId, update) => {
    await Order.updateOne({ _id: orderId }, update);
  },
};

export interface CancellationResult {
  refunded: boolean;
  refundAmount: number;
  refundId: string | null;
  /** Why no refund was made, when there was nothing Stripe could refund. */
  noRefundReason: string | null;
}

const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export const cancelOrderWithRefund = async (
  order: any,
  actor: { id: string; name: string },
  reason: string,
  deps: CancellationDeps = defaultDeps,
): Promise<CancellationResult> => {
  const refusal = cancellationError(order?.status);
  if (refusal) throw httpError(refusal, 409);
  const why = String(reason || "").trim();
  if (!why) throw httpError("A reason is required to cancel an order.", 400);

  const intentId = String(order?.payment?.paymentIntentId || "");
  const paid = /^pi_/.test(intentId);
  let refundId: string | null = null;
  let refundAmount = 0;
  let noRefundReason: string | null = null;

  if (paid) {
    if (!deps.stripeConfigured()) throw httpError("Stripe isn't configured, so the refund can't be made. The order was not cancelled.", 503);
    try {
      const refund = await deps.refund(intentId, String(order._id));
      refundId = refund.id;
      refundAmount = refund.amount;
    } catch (err: any) {
      throw httpError(`Stripe couldn't refund this payment, so the order was not cancelled: ${err?.message || "unknown error"}`, 502);
    }
  } else {
    noRefundReason = "This order has no card payment on record, so there was nothing to refund.";
  }

  const now = new Date();
  const set: Record<string, unknown> = {
    status: "CANCELLED",
    updatedAt: now,
    cancellation: { reason: why, at: now, byId: actor.id, byName: actor.name },
  };
  if (refundId) {
    set["payment.refundId"] = refundId;
    set["payment.refundedAmount"] = refundAmount;
    set["payment.refundedAt"] = now;
  }
  await deps.save(String(order._id), {
    $set: set,
    $push: {
      statusTimeline: {
        status: "CANCELLED",
        time: now,
        message: refundId
          ? `Cancelled and refunded $${refundAmount.toFixed(2)}: ${why}`
          : `Cancelled, no refund needed: ${why}`,
        actorRole: "ADMIN",
        actorId: actor.id,
        actorName: actor.name,
      },
    },
  });

  return { refunded: Boolean(refundId), refundAmount, refundId, noRefundReason };
};
