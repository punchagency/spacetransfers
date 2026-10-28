import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";
import { env } from "../config/env.js";
import { normaliseCountry } from "../utils/country.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import { publishOrderEvent } from "./orderSyncHub.js";
import { syncPartnerCapacitySafe } from "./partnerCapacity.service.js";
import { getGlobalPricing, totalBillableSqFt } from "./pricing.service.js";
import { deriveParcel } from "./packaging.service.js";
import { closeRequestOnShipment } from "./cancellationRequest.service.js";
import {
  areLabelPurchasesEnabled,
  buyShipment,
  createShipment,
  isEasyPostConfigured,
  labelOf,
  mapRates,
  refundShipment,
  retrieveShipment,
  selectService,
  trackerOutcome,
  TRACKING_STATUS_LABELS,
  type ShipAddress,
} from "./easypost.service.js";

/**
 * The shipping label for an order, from the partner marking the job ready to
 * the carrier delivering it.
 *
 * A label is bought when the partner moves a job to "ready to ship"
 * (QUALITY_CHECK). It ships from the partner's business address, on the
 * service the customer was quoted and paid for, in a parcel sized the way the
 * quote sized it. The shipment's id is saved before the purchase, so a retry
 * after a failure finds the label already bought instead of buying another.
 */

const displayOf = (order: any) => String(order?.displayId || String(order?._id || "").slice(-6).toUpperCase());

const failLabel = (message: string) => Object.assign(new Error(message), { labelError: true });

/**
 * How long an attempt holds the lock. Making a label takes seconds; an attempt
 * still holding it after this was cut off (the API restarted mid-way), and a
 * new one may start.
 */
export const LABEL_LOCK_MS = 5 * 60 * 1000;

/** Whether a label is being made right now, as opposed to an attempt that was cut off. */
export const isLabelInProgress = (requestedAt: unknown, now = Date.now()): boolean => {
  const at = requestedAt ? new Date(requestedAt as any).getTime() : NaN;
  return Number.isFinite(at) && now - at < LABEL_LOCK_MS;
};

/**
 * Where the parcel ships from: the partner's business address, which the label
 * prints as its return address. The configured SHIP_FROM address only places
 * quotes; on a label it would send returned parcels somewhere nobody is.
 */
export const shipFromFor = (partner: any): ShipAddress | null => {
  const b = partner?.businessAddress;
  if (b?.street && b?.postalCode) {
    return {
      name: String(partner.name || partner.companyName || "Print Partner"),
      company: String(partner.companyName || ""),
      street1: String(b.street),
      city: String(b.city || ""),
      state: String(b.state || ""),
      zip: String(b.postalCode),
      country: String(b.country || "US"),
      phone: String(partner.phone || env.shipFrom.phone || ""),
    };
  }
  return null;
};

/** Makes the label for an order now at "ready to ship". Safe to call twice: the second waits its turn. */
export const requestShippingLabel = async (orderId: string): Promise<void> => {
  const claimed: any = await Order.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      status: "QUALITY_CHECK",
      $and: [
        { $or: [{ labelRequestedAt: null }, { labelRequestedAt: { $lt: new Date(Date.now() - LABEL_LOCK_MS) } }] },
        { $or: [{ labelUrl: null }, { labelUrl: { $exists: false } }] },
      ],
    },
    { $set: { labelRequestedAt: new Date(), labelError: null } },
    { new: false },
  ).lean();
  if (!claimed) return;
  const displayId = displayOf(claimed);

  try {
    if (!isEasyPostConfigured()) throw failLabel("Shipping labels aren't set up yet. Space Transfers has been told.");
    const addr = claimed.shippingAddress || {};
    if (!addr.street || !addr.city || !addr.state || !addr.postalCode) throw failLabel("The customer's shipping address is incomplete.");
    const country = normaliseCountry(addr.country);
    if (country !== "US") throw failLabel(`Labels can only be made for US addresses; this order is going to ${addr.country || country}.`);

    const partner: any = claimed.assignedPrinter
      ? await User.findById(claimed.assignedPrinter).select("name companyName phone businessAddress").lean()
      : null;
    const from = shipFromFor(partner);
    if (!from) throw failLabel("There's no ship-from address: the partner has no business address on record.");

    // A label bought last time whose answer never arrived is found here, not bought twice.
    let shipment: any = claimed.easyPostShipmentId ? await retrieveShipment(claimed.easyPostShipmentId).catch(() => null) : null;
    if (!labelOf(shipment)) {
      // Unbought shipments cost nothing, so each attempt starts with fresh rates.
      const pricing = await getGlobalPricing();
      shipment = await createShipment({
        reference: displayId,
        from,
        to: {
          name: `${claimed.customer?.firstName || ""} ${claimed.customer?.lastName || ""}`.trim() || "Customer",
          street1: String(addr.street),
          city: String(addr.city),
          state: String(addr.state),
          zip: String(addr.postalCode),
          country,
          phone: claimed.customer?.phone ? String(claimed.customer.phone) : undefined,
          email: claimed.customer?.email ? String(claimed.customer.email) : undefined,
          residential: true,
        },
        parcel: deriveParcel(totalBillableSqFt(claimed.items || [], pricing), pricing.packaging),
      });
      // Kept before buying, so a retry finds this shipment rather than making a second.
      await Order.updateOne({ _id: claimed._id }, { $set: { easyPostShipmentId: String(shipment.id) } });
      const rates = mapRates(shipment.rates);
      const method = String(claimed.shippingMethod) === "express" ? "express" : "standard";
      const rate = selectService(rates, method, { carrier: claimed.shippingQuote?.carrier, service: claimed.shippingQuote?.serviceCode });
      if (!rate) {
        const why = (Array.isArray(shipment.messages) ? shipment.messages : []).map((m: any) => m?.message).filter(Boolean).join("; ");
        throw failLabel(`No carrier offered a rate for this parcel${why ? `: ${why}` : "."}`);
      }
      if (!areLabelPurchasesEnabled()) throw failLabel("Buying labels is switched off in this environment.");
      shipment = await buyShipment(String(shipment.id), rate.id);
    }

    const label = labelOf(shipment);
    if (!label) throw failLabel("The label was bought but EasyPost sent back no printable copy. Space Transfers has been told.");
    const now = new Date();
    await Order.updateOne(
      { _id: claimed._id },
      {
        $set: {
          trackingNumber: label.trackingCode,
          carrier: label.carrier,
          labelService: label.service,
          labelUrl: label.labelUrl,
          labelCost: label.cost,
          labelPurchasedAt: now,
          labelError: null,
          easyPostShipmentId: label.shipmentId,
          easyPostTrackerId: label.trackerId,
          trackingUrl: label.trackingUrl,
          trackingStatus: "pre_transit",
          updatedAt: now,
        },
        $push: {
          statusTimeline: {
            status: "QUALITY_CHECK",
            time: now,
            message: `Shipping label ready: ${label.carrier} ${label.service}, tracking ${label.trackingCode}.`,
            actorRole: "SYSTEM",
            actorId: "EASYPOST",
            actorName: "Shipping",
          },
        },
      },
    );
    if (claimed.assignedPrinter) {
      notifyPrinter({
        printerId: String(claimed.assignedPrinter),
        category: "jobs",
        priority: "medium",
        title: "Shipping label ready",
        message: `The label for order #${displayId} is ready. Open the order to print it, then confirm the shipment.`,
        meta: { orderId, displayId, trackingNumber: label.trackingCode, carrier: label.carrier },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }
  } catch (err: any) {
    const message = String(err?.message || "The label couldn't be made.").slice(0, 500);
    console.error(`[LABEL] order ${orderId} (${displayId}): ${message}`);
    await Order.updateOne(
      { _id: claimed._id },
      {
        $set: { labelRequestedAt: null, labelError: message },
        $push: {
          statusTimeline: { status: "QUALITY_CHECK", time: new Date(), message: `Shipping label failed: ${message}`, actorRole: "SYSTEM", actorId: "EASYPOST", actorName: "Shipping" },
        },
      },
    ).catch(() => {});
    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: "Shipping label failed",
      message: `Order #${displayId}: ${message.slice(0, 200)}`,
      meta: { orderId, displayId, type: "label_failed" },
    }).catch(() => {});
  }
};

/** The label fields an order drops when its label is given up. */
const CLEARED_LABEL = {
  labelUrl: null,
  labelCost: null,
  labelService: null,
  labelRequestedAt: null,
  labelPurchasedAt: null,
  easyPostShipmentId: null,
  easyPostTrackerId: null,
  trackingNumber: null,
  trackingUrl: null,
  carrier: null,
  trackingStatus: null,
  trackingStatusDetail: null,
  estimatedDeliveryAt: null,
  trackingUpdatedAt: null,
};

/**
 * Sends an unused label back for a refund. A cancelled order keeps the record;
 * a job that moves to another partner drops the label too (`clear`), so the new
 * partner makes their own from their own address. Never throws.
 */
export const voidUnusedLabel = async (order: any, reason: string, opts: { clear: boolean; note?: string } = { clear: false }): Promise<void> => {
  if (!order?._id) return;
  const shipped = ["SHIPPED", "COMPLETED"].includes(String(order.status || "").toUpperCase());
  const shipmentId = order.easyPostShipmentId ? String(order.easyPostShipmentId) : null;
  if (shipped || (!shipmentId && !opts.clear)) return;
  const displayId = displayOf(order);
  let refund: string | null = null;
  if (shipmentId && order.labelUrl) {
    try {
      refund = await refundShipment(shipmentId);
    } catch (err: any) {
      refund = "failed";
      notifyAllAdmins({
        category: "orders",
        priority: "high",
        title: "Unused label not refunded",
        message: `Order #${displayId}'s label couldn't be sent back for a refund (${String(err?.message || "").slice(0, 150)}). Ask for it in EasyPost.`,
        meta: { orderId: String(order._id), displayId, shipmentId, type: "label_refund_failed" },
      }).catch(() => {});
    }
  }
  const now = new Date();
  const set: Record<string, unknown> = {};
  if (refund) set.labelRefund = { status: refund, requestedAt: now, shipmentId };
  if (opts.clear) Object.assign(set, CLEARED_LABEL, { labelError: opts.note ?? null });
  if (Object.keys(set).length === 0) return;
  await Order.updateOne(
    { _id: order._id },
    {
      $set: set,
      ...(refund
        ? {
            $push: {
              statusTimeline: {
                status: String(order.status || ""),
                time: now,
                message: `Unused shipping label ${refund === "failed" ? "couldn't be refunded" : "sent back for a refund"} (${reason}).`,
                actorRole: "SYSTEM",
                actorId: "EASYPOST",
                actorName: "Shipping",
              },
            },
          }
        : {}),
    },
  ).catch((err: any) => console.error(`[LABEL] order ${displayId}: recording the label refund failed: ${err?.message}`));
};

/**
 * Applies what the carrier says about a parcel: keeps the latest status on the
 * order, ships an order the carrier has picked up, completes a delivered one,
 * and tells the admins about returns and failures once each.
 */
/**
 * Webhooks can arrive out of order, so a tracker's word only replaces what's
 * recorded when it isn't older. One without a time only lands on an order that
 * has none recorded.
 */
export const trackerRecency = (tracker: any): { updatedAt: Date | null; notOlder: Record<string, unknown> } => {
  const at = tracker?.updated_at ? new Date(tracker.updated_at) : null;
  const updatedAt = at && !Number.isNaN(at.getTime()) ? at : null;
  return {
    updatedAt,
    notOlder: updatedAt
      ? { $or: [{ trackingUpdatedAt: null }, { trackingUpdatedAt: { $lte: updatedAt } }] }
      : { trackingUpdatedAt: null },
  };
};

export const applyTrackerUpdate = async (order: any, tracker: any, source: "webhook" | "poller"): Promise<void> => {
  const status = String(tracker?.status || "").toLowerCase();
  if (!order?._id || !status) return;
  const orderId = String(order._id);
  const displayId = displayOf(order);
  const est = tracker?.est_delivery_date ? new Date(tracker.est_delivery_date) : null;
  const { updatedAt, notOlder } = trackerRecency(tracker);
  const applied = await Order.updateOne(
    { _id: order._id, ...notOlder },
    {
      $set: {
        trackingStatus: status,
        trackingStatusDetail: tracker?.status_detail ? String(tracker.status_detail) : null,
        estimatedDeliveryAt: est && !Number.isNaN(est.getTime()) ? est : null,
        trackingUpdatedAt: updatedAt,
        ...(tracker?.id && !order.easyPostTrackerId ? { easyPostTrackerId: String(tracker.id) } : {}),
        ...(tracker?.public_url && !order.trackingUrl ? { trackingUrl: String(tracker.public_url) } : {}),
      },
    },
  );
  if (applied.matchedCount === 0) return;

  const outcome = trackerOutcome(order.status, status);
  const now = new Date();
  const by = { actorRole: "SYSTEM", actorId: source === "webhook" ? "EASYPOST_WEBHOOK" : "TRACKING_POLLER", actorName: "Carrier tracking" };
  if (outcome === "SHIPPED") {
    const entry = { status: "SHIPPED", time: now, message: `The carrier has the parcel (${TRACKING_STATUS_LABELS[status] || status}).`, ...by };
    const moved = await Order.findOneAndUpdate({ _id: order._id, status: "QUALITY_CHECK" }, { $set: { status: "SHIPPED", updatedAt: now }, $push: { statusTimeline: entry } });
    if (!moved) return;
    publishOrderEvent(orderId, "order.status.changed", { orderId, status: "SHIPPED", from: "QUALITY_CHECK", to: "SHIPPED", trackingNumber: order.trackingNumber, carrier: order.carrier, updatedAt: now, lastTimelineEntry: entry });
    if (order.assignedPrinter) syncPartnerCapacitySafe(String(order.assignedPrinter));
    await closeRequestOnShipment(orderId).catch(() => {});
    notifyAllAdmins({ category: "orders", priority: "low", title: "Order shipped", message: `Order #${displayId} is with the carrier.`, meta: { orderId, displayId, trackingNumber: order.trackingNumber } }).catch(() => {});
  } else if (outcome === "COMPLETED") {
    const deliveredAt = tracker?.tracking_details?.length ? new Date(tracker.tracking_details[tracker.tracking_details.length - 1]?.datetime || now) : now;
    const entry = { status: "COMPLETED", time: now, message: `Delivered${Number.isNaN(deliveredAt.getTime()) ? "" : ` ${deliveredAt.toISOString().slice(0, 10)}`}, confirmed by the carrier.`, ...by };
    const moved = await Order.findOneAndUpdate(
      { _id: order._id, status: { $in: ["SHIPPED", "QUALITY_CHECK"] } },
      { $set: { status: "COMPLETED", updatedAt: now }, $push: { statusTimeline: entry } },
      { new: false },
    );
    if (!moved) return;
    const from = String((moved as any).status);
    publishOrderEvent(orderId, "order.status.changed", { orderId, status: "COMPLETED", from, to: "COMPLETED", updatedAt: now, lastTimelineEntry: entry });
    if (from === "QUALITY_CHECK") {
      if (order.assignedPrinter) syncPartnerCapacitySafe(String(order.assignedPrinter));
      await closeRequestOnShipment(orderId).catch(() => {});
    }
    notifyAllAdmins({ category: "orders", priority: "medium", title: "Order delivered", message: `Order #${displayId} has been delivered and marked Completed.`, meta: { orderId, displayId, trackingNumber: order.trackingNumber } }).catch(() => {});
  } else if (outcome === "PROBLEM" && order.trackingStatus !== status) {
    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: "Delivery problem",
      message: `Order #${displayId}: ${TRACKING_STATUS_LABELS[status] || status}${tracker?.status_detail ? ` (${String(tracker.status_detail).replace(/_/g, " ")})` : ""}. Tracking ${order.trackingNumber || ""}.`,
      meta: { orderId, displayId, trackingStatus: status, type: "delivery_problem" },
    }).catch(() => {});
  }
};
