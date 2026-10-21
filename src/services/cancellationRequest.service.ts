import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";
import { CANCELLABLE_STATUSES, cancelOrderWithRefund } from "./orderCancellation.service.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { publishOrderEvent } from "./orderSyncHub.js";
import { syncPartnerCapacitySafe } from "./partnerCapacity.service.js";
import { sendCancellationDeclinedEmail, sendOrderCancelledEmail } from "./orderEmails.service.js";

/**
 * A customer cancelling their own order.
 *
 * Before a partner has it, the order is simply cancelled and refunded. Once a
 * partner has it, they may already be printing, so the customer asks and the
 * partner answers: accepting cancels and refunds the order, declining keeps it
 * going and tells the customer why. While a request is open the partner can't
 * move the job on or hand it back, so the two sides can't drift apart.
 */

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

const REASON_MAX = 500;
/** After this long without an answer, admins are told. */
export const ESCALATE_AFTER_MS = 12 * 60 * 60 * 1000;

const isCancellable = (status: unknown) => (CANCELLABLE_STATUSES as readonly string[]).includes(String(status || "").toUpperCase());

export type CustomerCancelOption =
  /** Cancelled at once: no partner has the order yet. */
  | "now"
  /** The partner is asked first. */
  | "request"
  | null;

/** What the customer may do about cancelling this order, and the state of any request. */
export const customerCancellation = (order: any) => {
  const request = order?.cancellationRequest || null;
  const pending = request?.status === "PENDING";
  const declined = request?.status === "DECLINED";
  let option: CustomerCancelOption = null;
  if (isCancellable(order?.status) && !pending && !declined) option = order?.assignedPrinter ? "request" : "now";
  return {
    option,
    request:
      request && request.status !== "WITHDRAWN"
        ? {
            status: String(request.status),
            reason: request.reason || null,
            requestedAt: request.requestedAt || null,
            respondedAt: request.respondedAt || null,
            declineReason: request.declineReason || null,
          }
        : null,
  };
};

/** Whether an open request stops the partner from moving this job on. */
export const cancellationBlocksPartner = (order: any): string | null =>
  order?.cancellationRequest?.status === "PENDING"
    ? "The customer has asked to cancel this order. Accept or decline their request first."
    : null;

export const cleanReason = (value: unknown, required: boolean): string => {
  const text = typeof value === "string" ? value.trim().replace(/\s+\n/g, "\n") : "";
  if (required && text.length < 3) throw fail("Say why, in a few words.", 400);
  if (text.length > REASON_MAX) throw fail(`Keep it under ${REASON_MAX} characters.`, 400);
  return text;
};

const numberOf = (order: any) => String(order?.displayId || order?._id || "");

/** The customer cancels, or asks to. */
export const requestCancellation = async (orderId: string, userId: string, reasonInput: unknown) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) throw fail("Order not found", 404);
  const reason = cleanReason(reasonInput, false);
  const order: any = await Order.findOne({ _id: orderId, user: userId }).lean();
  if (!order) throw fail("Order not found", 404);
  const { option } = customerCancellation(order);
  if (!option) {
    if (order.cancellationRequest?.status === "PENDING") throw fail("You've already asked to cancel this order.", 409);
    if (order.cancellationRequest?.status === "DECLINED") throw fail("The partner couldn't cancel this order, as they told you. Reply to their email if you need help.", 409);
    throw fail(String(order.status).toUpperCase() === "CANCELLED" ? "This order is already cancelled." : "This order has shipped, so it can't be cancelled.", 409);
  }
  const customerName = `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "The customer";
  const number = numberOf(order);

  if (option === "now") {
    const result = await cancelOrderWithRefund(
      order,
      { id: userId, name: customerName },
      reason ? `Cancelled by the customer: ${reason}` : "Cancelled by the customer",
      undefined,
      { actorRole: "CUSTOMER" },
    );
    // A partner may have been given it in the moment it took; they need to stop.
    const after: any = await Order.findById(orderId).select("assignedPrinter").lean();
    if (after?.assignedPrinter) {
      syncPartnerCapacitySafe(String(after.assignedPrinter));
      notifyPrinter({
        printerId: String(after.assignedPrinter),
        category: "jobs",
        priority: "high",
        title: "Order cancelled",
        message: `Order ${number} was cancelled by the customer before it started. Please don't print it.`,
        meta: { orderId, status: "CANCELLED" },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }
    publishOrderEvent(orderId, "order.status.changed", { orderId, status: "CANCELLED", updatedAt: new Date() });
    notifyAllAdmins({
      category: "orders",
      priority: "low",
      title: "Customer cancelled an order",
      message: `${number} was cancelled by the customer before a partner had it.${result.refunded ? ` $${result.refundAmount.toFixed(2)} refunded.` : ""}`,
      meta: { orderId, displayId: number, type: "customer_cancelled" },
    }).catch(() => {});
    const mail = await sendOrderCancelledEmail(order, result.refundAmount, reason ? `You cancelled it: ${reason}` : "You cancelled it.");
    return { outcome: "cancelled" as const, refundAmount: result.refundAmount, customerNotified: Boolean(mail?.sent) };
  }

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    {
      _id: orderId,
      user: userId,
      assignedPrinter: order.assignedPrinter,
      status: { $in: [...CANCELLABLE_STATUSES] },
      "cancellationRequest.status": { $nin: ["PENDING", "DECLINED"] },
    },
    {
      $set: { cancellationRequest: { status: "PENDING", reason: reason || null, requestedAt: now, respondedAt: null, respondedByName: null, declineReason: null, escalatedAt: null } },
      $push: {
        statusTimeline: {
          status: order.status,
          time: now,
          message: `The customer asked to cancel${reason ? `: ${reason}` : ""}`,
          actorRole: "CUSTOMER",
          actorId: userId,
          actorName: customerName,
        },
      },
    },
    { new: true },
  ).lean();
  if (!updated) throw fail("This order changed while you were asking. Please refresh and try again.", 409);

  const partnerId = String(order.assignedPrinter);
  notifyPrinter({
    printerId: partnerId,
    category: "jobs",
    priority: "high",
    title: "Customer asked to cancel",
    message: `The customer asked to cancel order ${number}${reason ? `: "${reason}"` : "."} Accept or decline from the job.`,
    meta: { orderId, type: "cancel_requested" },
    settingsKey: "orderUpdates",
  }).catch(() => {});
  notifyAllAdmins({
    category: "orders",
    priority: "medium",
    title: "Customer asked to cancel",
    message: `${number}: the customer asked to cancel${reason ? ` ("${reason}")` : ""}. Waiting for the partner to answer.`,
    meta: { orderId, displayId: number, type: "cancel_requested" },
  }).catch(() => {});
  publishOrderEvent(orderId, "order.cancellation.changed", { orderId, status: "PENDING", updatedAt: now });
  return { outcome: "requested" as const };
};

/** The customer changes their mind while the partner hasn't answered. */
export const withdrawCancellation = async (orderId: string, userId: string) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) throw fail("Order not found", 404);
  const current: any = await Order.findOne({ _id: orderId, user: userId }).select("status").lean();
  if (!current) throw fail("Order not found", 404);
  const now = new Date();
  const order: any = await Order.findOneAndUpdate(
    { _id: orderId, user: userId, "cancellationRequest.status": "PENDING" },
    {
      $set: { "cancellationRequest.status": "WITHDRAWN", "cancellationRequest.respondedAt": now },
      $push: { statusTimeline: { status: current.status, time: now, message: "The customer withdrew their request to cancel", actorRole: "CUSTOMER", actorId: userId } },
    },
    { new: true },
  ).lean();
  if (!order) throw fail("There's no open request to cancel this order.", 409);
  if (order.assignedPrinter) {
    notifyPrinter({
      printerId: String(order.assignedPrinter),
      category: "jobs",
      priority: "medium",
      title: "Cancellation withdrawn",
      message: `The customer no longer wants to cancel order ${numberOf(order)}. Carry on as normal.`,
      meta: { orderId, type: "cancel_withdrawn" },
      settingsKey: "orderUpdates",
    }).catch(() => {});
  }
  publishOrderEvent(orderId, "order.cancellation.changed", { orderId, status: "WITHDRAWN", updatedAt: now });
  return { withdrawn: true };
};

/** The partner's answer. */
export const respondToCancellation = async (orderId: string, printerId: string, decision: unknown, reasonInput: unknown) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) throw fail("Order not found", 404);
  const accept = decision === "accept";
  if (!accept && decision !== "decline") throw fail("Choose to accept or decline.", 400);
  const declineReason = accept ? "" : cleanReason(reasonInput, true);
  const order: any = await Order.findOne({ _id: orderId, assignedPrinter: printerId }).lean();
  if (!order) throw fail("Order not found or not assigned to you", 404);
  if (order.cancellationRequest?.status !== "PENDING") throw fail("There's no open request to cancel this order.", 409);
  const partner: any = await User.findById(printerId).select("name companyName").lean();
  const partnerName = String(partner?.companyName || partner?.name || "Your print partner");
  const number = numberOf(order);

  if (accept) {
    const asked = order.cancellationRequest.reason;
    const result = await cancelOrderWithRefund(
      order,
      { id: printerId, name: partnerName },
      `Cancelled at the customer's request${asked ? `: ${asked}` : ""}`,
      undefined,
      { actorRole: "PRINTER" },
    );
    syncPartnerCapacitySafe(printerId);
    publishOrderEvent(orderId, "order.status.changed", { orderId, status: "CANCELLED", updatedAt: new Date() });
    notifyAllAdmins({
      category: "orders",
      priority: "low",
      title: "Partner accepted a cancellation",
      message: `${partnerName} cancelled ${number} at the customer's request.${result.refunded ? ` $${result.refundAmount.toFixed(2)} refunded.` : ""}`,
      meta: { orderId, displayId: number, type: "cancel_accepted" },
    }).catch(() => {});
    const mail = await sendOrderCancelledEmail(order, result.refundAmount, "Your print partner has cancelled it, as you asked.");
    return { outcome: "cancelled" as const, refundAmount: result.refundAmount, customerNotified: Boolean(mail?.sent) };
  }

  const now = new Date();
  const updated: any = await Order.findOneAndUpdate(
    { _id: orderId, assignedPrinter: printerId, "cancellationRequest.status": "PENDING" },
    {
      $set: {
        "cancellationRequest.status": "DECLINED",
        "cancellationRequest.respondedAt": now,
        "cancellationRequest.respondedByName": partnerName,
        "cancellationRequest.declineReason": declineReason,
      },
      $push: {
        statusTimeline: { status: order.status, time: now, message: `Cancellation declined by the partner: ${declineReason}`, actorRole: "PRINTER", actorId: printerId, actorName: partnerName },
      },
    },
    { new: true },
  ).lean();
  if (!updated) throw fail("There's no open request to cancel this order.", 409);
  publishOrderEvent(orderId, "order.cancellation.changed", { orderId, status: "DECLINED", updatedAt: now });
  notifyAllAdmins({
    category: "orders",
    priority: "medium",
    title: "Partner declined a cancellation",
    message: `${partnerName} declined to cancel ${number}: "${declineReason}". The customer has been told. You can still cancel it from the order page.`,
    meta: { orderId, displayId: number, type: "cancel_declined" },
  }).catch(() => {});
  const mail = await sendCancellationDeclinedEmail(order, declineReason);
  return { outcome: "declined" as const, customerNotified: Boolean(mail?.sent) };
};

/**
 * An order that ships while a request is open has answered it: it is too late.
 * Called wherever an order becomes SHIPPED outside the partner's own controls.
 */
export const closeRequestOnShipment = async (orderId: string) => {
  const now = new Date();
  const order: any = await Order.findOneAndUpdate(
    { _id: orderId, "cancellationRequest.status": "PENDING" },
    {
      $set: {
        "cancellationRequest.status": "DECLINED",
        "cancellationRequest.respondedAt": now,
        "cancellationRequest.respondedByName": "Space Transfers",
        "cancellationRequest.declineReason": "Your order had already shipped.",
      },
    },
    { new: true },
  ).lean();
  if (!order) return;
  publishOrderEvent(orderId, "order.cancellation.changed", { orderId, status: "DECLINED", updatedAt: now });
  await sendCancellationDeclinedEmail(order, "Your order had already shipped.");
};

/** Requests nobody has answered: admins are told once, and the partner reminded. */
export const escalateUnansweredRequests = async (now = new Date()) => {
  const stale: any[] = await Order.find({
    "cancellationRequest.status": "PENDING",
    "cancellationRequest.requestedAt": { $lte: new Date(now.getTime() - ESCALATE_AFTER_MS) },
    "cancellationRequest.escalatedAt": null,
  })
    .select("displayId assignedPrinter cancellationRequest")
    .limit(100)
    .lean();
  for (const order of stale) {
    const claimed = await Order.updateOne(
      { _id: order._id, "cancellationRequest.status": "PENDING", "cancellationRequest.escalatedAt": null },
      { $set: { "cancellationRequest.escalatedAt": now } },
    );
    if (!claimed.modifiedCount) continue;
    const number = numberOf(order);
    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: "Cancellation request unanswered",
      message: `The customer asked to cancel ${number} over 12 hours ago and the partner hasn't answered. You can cancel it from the order page.`,
      meta: { orderId: String(order._id), displayId: number, type: "cancel_unanswered" },
    }).catch(() => {});
    if (order.assignedPrinter) {
      notifyPrinter({
        printerId: String(order.assignedPrinter),
        category: "jobs",
        priority: "high",
        title: "Customer still waiting for an answer",
        message: `The customer asked to cancel order ${number}. Please accept or decline so they know where they stand.`,
        meta: { orderId: String(order._id), type: "cancel_requested" },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }
  }
  return stale.length;
};

export const startCancellationEscalation = (intervalMs = 30 * 60 * 1000) => {
  const tick = () => escalateUnansweredRequests().catch((err: any) => console.warn(`[CANCEL_REQUEST] escalation failed: ${err?.message}`));
  setInterval(tick, intervalMs).unref();
};
