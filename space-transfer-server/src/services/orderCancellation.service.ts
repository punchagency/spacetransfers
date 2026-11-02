import { Order } from "../models/order.model.js";
import { isStripeConfigured, stripe } from "./stripe.service.js";
import { refundableAmount, refundRecord } from "./orderRefund.service.js";

/**
 * Cancelling a customer's order, with its refund.
 *
 * Only an admin cancels an order. A partner who can't do a job hands it back to
 * the queue instead. The refund is made first and the order is cancelled only
 * once Stripe has accepted it, so an order is never cancelled while the
 * customer is still charged. The refund is everything not yet refunded unless
 * the admin chooses less — work already done on the order can be kept back.
 */

/** Statuses an order can be cancelled from: anything before it ships. */
export const CANCELLABLE_STATUSES = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"] as const;

export const cancellationError = (status: unknown): string | null => {
  const s = String(status || "").toUpperCase();
  if (s === "CANCELLED") return "This order is already cancelled.";
  if (s === "SHIPPED" || s === "COMPLETED") return "This order has shipped, so it can't be cancelled here.";
  return (CANCELLABLE_STATUSES as readonly string[]).includes(s) ? null : "This order can't be cancelled.";
};

/** A partner can be paid for a cancelled job only if they had started it. */
export const canPayPartnerOnCancel = (order: any): boolean =>
  Boolean(order?.assignedPrinter) && ["PRINTING", "QUALITY_CHECK"].includes(String(order?.status || "").toUpperCase());

export interface CancellationDeps {
  stripeConfigured: () => boolean;
  /** Refunds `cents` of the payment. Returns Stripe's refund id and the amount in dollars. */
  refund: (paymentIntentId: string, orderId: string, cents: number) => Promise<{ id: string; amount: number }>;
  save: (orderId: string, update: Record<string, unknown>) => Promise<void>;
}

const defaultDeps: CancellationDeps = {
  stripeConfigured: isStripeConfigured,
  refund: async (paymentIntentId, orderId, cents) => {
    // The key makes a repeated click return the same refund instead of a second one.
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: cents, reason: "requested_by_customer", metadata: { orderId } },
      { idempotencyKey: `order-cancel-${orderId}-${cents}` },
    );
    return { id: refund.id, amount: Math.round(refund.amount) / 100 };
  },
  save: async (orderId, update) => {
    // A repeated request finds it already cancelled and records nothing twice.
    await Order.updateOne({ _id: orderId, status: { $ne: "CANCELLED" } }, update);
  },
};

export interface CancellationResult {
  refunded: boolean;
  refundAmount: number;
  refundId: string | null;
  /** Why no refund was made, when there was nothing Stripe could refund. */
  noRefundReason: string | null;
  /** The partner keeps this job's pay; it joins their next payout. */
  partnerPaid: boolean;
}

const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export const cancelOrderWithRefund = async (
  order: any,
  actor: { id: string; name: string },
  reason: string,
  deps: CancellationDeps = defaultDeps,
  options: {
    payPartner?: boolean;
    /** Dollars to refund. Left out: everything not yet refunded. Zero: cancel without a refund. */
    refundAmount?: number;
    /** Who cancelled it, for the timeline. Admins unless said otherwise. */
    actorRole?: "ADMIN" | "PRINTER" | "CUSTOMER";
  } = {},
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

  const left = refundableAmount(order);
  const asked = options.refundAmount;
  if (asked !== undefined) {
    if (!Number.isFinite(asked) || asked < 0 || Math.round(asked * 100) / 100 !== asked) {
      throw httpError("Enter the refund amount in dollars and cents.", 400);
    }
    if (asked > left) throw httpError(`The most that can be refunded on this order is $${left.toFixed(2)}.`, 400);
  }
  const toRefund = asked === undefined ? left : asked;

  if (!paid) {
    noRefundReason = "This order has no card payment on record, so there was nothing to refund.";
  } else if (left <= 0) {
    noRefundReason = "This order had already been refunded in full.";
  } else if (toRefund <= 0) {
    noRefundReason = "Cancelled without a refund, as chosen.";
  } else {
    if (!deps.stripeConfigured()) throw httpError("Stripe isn't configured, so the refund can't be made. The order was not cancelled.", 503);
    try {
      const refund = await deps.refund(intentId, String(order._id), Math.round(toRefund * 100));
      refundId = refund.id;
      refundAmount = refund.amount;
    } catch (err: any) {
      throw httpError(`Stripe couldn't refund this payment, so the order was not cancelled: ${err?.message || "unknown error"}`, 502);
    }
  }

  // Paying the partner only applies when one has actually started the job.
  const partnerPaid = Boolean(options.payPartner) && canPayPartnerOnCancel(order);

  const now = new Date();
  const set: Record<string, unknown> = {
    status: "CANCELLED",
    updatedAt: now,
    cancellation: { reason: why, at: now, byId: actor.id, byName: actor.name, partnerPaid },
  };
  // A customer's request to cancel is settled by the cancellation, whoever made it.
  if (order?.cancellationRequest?.status === "PENDING") {
    set["cancellationRequest.status"] = "ACCEPTED";
    set["cancellationRequest.respondedAt"] = now;
    set["cancellationRequest.respondedByName"] = actor.name;
  }
  const push: Record<string, unknown> = {};
  const paidTotal = Number(order?.pricing?.total) || 0;
  let keptBack = 0;
  if (refundId) {
    const record = refundRecord(order, { id: refundId, amount: refundAmount }, actor, why, now);
    Object.assign(set, record.set);
    push["payment.refunds"] = record.push;
    keptBack = Math.max(0, Math.round((paidTotal - record.totalRefunded) * 100) / 100);
  }
  await deps.save(String(order._id), {
    $set: set,
    $push: {
      ...push,
      statusTimeline: {
        status: "CANCELLED",
        time: now,
        message:
          (refundId
            ? keptBack > 0
              ? `Cancelled and refunded $${refundAmount.toFixed(2)} of $${paidTotal.toFixed(2)}: ${why}`
              : `Cancelled and refunded $${refundAmount.toFixed(2)}: ${why}`
            : paid && left > 0
              ? `Cancelled without a refund: ${why}`
              : `Cancelled, no refund needed: ${why}`) +
          (partnerPaid ? " The partner is still paid for this job." : ""),
        actorRole: options.actorRole || "ADMIN",
        actorId: actor.id,
        actorName: actor.name,
      },
    },
  });

  return { refunded: Boolean(refundId), refundAmount, refundId, noRefundReason, partnerPaid };
};
