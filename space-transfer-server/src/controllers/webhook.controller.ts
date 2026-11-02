import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { Order } from "../models/order.model.js";
import { verifyWebhookSignature } from "../services/easypost.service.js";
import { applyTrackerUpdate } from "../services/shippingLabel.service.js";

/**
 * EasyPost's webhook: tracking updates for parcels, and the outcome of label
 * refunds.
 *
 * Every event is signed: `X-Hmac-Signature` must match the raw body under
 * `EASYPOST_WEBHOOK_SECRET` (see `verifyWebhookSignature`), so the body is
 * received unparsed (`app.ts`). EasyPost waits seven seconds for an answer and
 * retries otherwise, so the event is acknowledged first and handled after.
 */

const ORDER_FIELDS = "_id displayId status trackingNumber carrier easyPostTrackerId trackingUrl trackingStatus assignedPrinter labelRefund easyPostShipmentId";

/** The order a tracker belongs to: by tracker id, or by tracking number for one made elsewhere. */
const orderForTracker = async (tracker: any) => {
  if (tracker?.id) {
    const byTracker = await Order.findOne({ easyPostTrackerId: String(tracker.id) }).select(ORDER_FIELDS).lean();
    if (byTracker) return byTracker;
  }
  if (tracker?.tracking_code) {
    return Order.findOne({ trackingNumber: String(tracker.tracking_code), status: { $nin: ["CANCELLED"] } })
      .sort({ createdAt: -1 })
      .select(ORDER_FIELDS)
      .lean();
  }
  return null;
};

export const handleEasyPostEvent = async (event: any): Promise<void> => {
  const result = event?.result;
  const description = String(event?.description || "");
  if (result?.object === "Tracker" && description.startsWith("tracker.")) {
    const order = await orderForTracker(result);
    if (order) await applyTrackerUpdate(order, result, "webhook");
    return;
  }
  // A refund's progress on a label sent back, as a Shipment or as a Refund: kept on the order it belonged to.
  const refunded =
    result?.object === "Shipment" && result?.id && result?.refund_status
      ? { shipmentId: String(result.id), status: String(result.refund_status) }
      : result?.object === "Refund" && result?.shipment_id && result?.status
        ? { shipmentId: String(result.shipment_id), status: String(result.status) }
        : null;
  if (refunded) {
    await Order.updateOne({ "labelRefund.shipmentId": refunded.shipmentId }, { $set: { "labelRefund.status": refunded.status } });
  }
};

export const easyPostWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const secret = env.easyPostWebhookSecret;
    if (!secret) {
      console.error("[EASYPOST_WEBHOOK] refused: EASYPOST_WEBHOOK_SECRET is not set, so events can't be verified");
      res.status(503).end();
      return;
    }
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) {
      res.status(400).end();
      return;
    }
    if (!verifyWebhookSignature(raw, req.get("x-hmac-signature"), secret)) {
      res.status(401).end();
      return;
    }
    let event: any;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      // Signed but unreadable: acknowledged, so it isn't retried forever.
      res.status(200).end();
      return;
    }
    res.status(200).end();
    handleEasyPostEvent(event).catch((err: any) =>
      console.error(`[EASYPOST_WEBHOOK] ${event?.description || "event"} ${event?.id || ""} failed: ${err?.message}`),
    );
  } catch (error) {
    next(error);
  }
};
