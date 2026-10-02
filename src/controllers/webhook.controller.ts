import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
// Node's crypto, not the WebCrypto global — only the former has timingSafeEqual.
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { Order } from "../models/order.model.js";
import { ssRequestByUrl, isShipStationConfigured } from "../services/shipstation.service.js";
import { publishOrderEvent } from "../services/orderSyncHub.js";
import { notifyAllAdmins } from "../services/adminNotifications.service.js";

// ── ShipStation webhook payload ───────────────────────────────────────────────
//
// ShipStation POSTs a thin envelope:
//   { resource_url: "https://ssapi.shipstation.com/...", resource_type: "SHIP_NOTIFY" }
//
// We respond 200 immediately, then fetch the resource_url in the background so
// ShipStation doesn't time out waiting for us.
//
// Supported event types:
//   SHIP_NOTIFY   — a shipment / label was created in ShipStation
//   ORDER_NOTIFY  — an order status changed inside ShipStation
//
// Security: caller must supply ?token=<SHIPSTATION_WEBHOOK_SECRET> in the URL.
// Register the webhook in ShipStation → Settings → Webhooks as:
//   https://yourserver.com/api/webhooks/shipstation?token=<SHIPSTATION_WEBHOOK_SECRET>

interface SSWebhookBody {
  resource_url?: string;
  resource_type?: string;
}

interface SSShipmentPayload {
  shipments?: Array<{
    shipmentId?: number;
    orderId?: number;
    orderNumber?: string;
    trackingNumber?: string;
    carrierCode?: string;
    serviceCode?: string;
    shipDate?: string;
    voided?: boolean;
  }>;
}

interface SSOrderPayload {
  orders?: Array<{
    orderId?: number;
    orderNumber?: string;
    orderStatus?: string;
    trackingNumber?: string;
    carrierCode?: string;
  }>;
}

async function handleShipNotify(resourceUrl: string): Promise<void> {
  const payload = await ssRequestByUrl<SSShipmentPayload>(resourceUrl);
  const shipments = Array.isArray(payload?.shipments) ? payload.shipments : [];

  for (const shipment of shipments) {
    if (shipment.voided) continue;

    const orderNumber = String(shipment.orderNumber || "");
    const trackingNumber = String(shipment.trackingNumber || "").trim();
    const carrier = String(shipment.carrierCode || "").trim();
    const shipStationShipmentId = String(shipment.shipmentId ?? "");
    const shipStationOrderId = String(shipment.orderId ?? "");

    if (!orderNumber && !shipStationOrderId) continue;

    // Find our order by displayId (ShipStation orderNumber = our displayId) or SS order ID.
    const query: any = { $or: [] };
    if (orderNumber) query.$or.push({ displayId: orderNumber });
    if (shipStationOrderId) query.$or.push({ shipStationOrderId });
    if (query.$or.length === 0) continue;

    const order = await Order.findOne(query).lean();
    if (!order) {
      console.log(`[SS Webhook] SHIP_NOTIFY — no matching order for orderNumber=${orderNumber}`);
      continue;
    }

    const orderId = String((order as any)._id);
    const displayId = String((order as any).displayId || orderId);
    const currentStatus = String((order as any).status || "");

    // If already SHIPPED or further along (COMPLETED, CANCELLED), just store new tracking
    // fields without overwriting the status.
    const alreadyShipped = ["SHIPPED", "COMPLETED"].includes(currentStatus.toUpperCase());

    const now = new Date();
    const updateFields: any = { updatedAt: now };
    if (trackingNumber && !(order as any).trackingNumber) updateFields.trackingNumber = trackingNumber;
    if (carrier && !(order as any).carrier) updateFields.carrier = carrier;
    if (shipStationShipmentId && !(order as any).shipStationShipmentId)
      updateFields.shipStationShipmentId = shipStationShipmentId;
    if (shipStationOrderId && !(order as any).shipStationOrderId)
      updateFields.shipStationOrderId = shipStationOrderId;

    if (!alreadyShipped) {
      updateFields.status = "SHIPPED";
      updateFields.shipStationTriggeredAt = updateFields.shipStationTriggeredAt ?? now;
    }

    const timelineEntry = {
      status: alreadyShipped ? currentStatus : "SHIPPED",
      time: now,
      message: `ShipStation SHIP_NOTIFY received. Carrier: ${carrier || "unknown"}, Tracking: ${trackingNumber || "unknown"}.`,
      actorRole: "SYSTEM",
      actorId: "SHIPSTATION_WEBHOOK",
      actorName: "ShipStation",
    };

    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      { $set: updateFields, $push: { statusTimeline: timelineEntry } }
    );

    if (!alreadyShipped) {
      publishOrderEvent(orderId, "order.status.changed", {
        orderId,
        status: "SHIPPED",
        from: currentStatus,
        to: "SHIPPED",
        trackingNumber,
        carrier,
        updatedAt: now,
        lastTimelineEntry: timelineEntry,
      });

      notifyAllAdmins({
        category: "orders",
        priority: "medium",
        title: "Order shipped (ShipStation webhook)",
        message: `Order #${displayId} confirmed shipped. Carrier: ${carrier}, Tracking: ${trackingNumber}.`,
        meta: { orderId, displayId, trackingNumber, carrier },
      }).catch(() => {});
    }

    console.log(
      `[SS Webhook] SHIP_NOTIFY processed — order ${orderId} (${displayId}), ` +
      `tracking: ${trackingNumber}, carrier: ${carrier}, statusUpdated: ${!alreadyShipped}`
    );
  }
}

async function handleOrderNotify(resourceUrl: string): Promise<void> {
  const payload = await ssRequestByUrl<SSOrderPayload>(resourceUrl);
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];

  for (const ssOrder of orders) {
    const orderNumber = String(ssOrder.orderNumber || "");
    const ssStatus = String(ssOrder.orderStatus || "").toLowerCase();
    const trackingNumber = String(ssOrder.trackingNumber || "").trim();
    const carrier = String(ssOrder.carrierCode || "").trim();

    if (!orderNumber) continue;

    const order = await Order.findOne({ displayId: orderNumber }).lean();
    if (!order) continue;

    const orderId = String((order as any)._id);
    const displayId = String((order as any).displayId || orderId);

    // Map ShipStation status → our status.
    // Only act on shipped/delivered transitions — we manage other statuses internally.
    const statusMap: Record<string, string> = {
      shipped: "SHIPPED",
      delivered: "COMPLETED",
    };
    const nextStatus = statusMap[ssStatus];
    if (!nextStatus) continue;

    const currentStatus = String((order as any).status || "").toUpperCase();
    if (currentStatus === nextStatus || currentStatus === "COMPLETED") continue;

    const now = new Date();
    const timelineEntry = {
      status: nextStatus,
      time: now,
      message: `ShipStation ORDER_NOTIFY: status changed to ${ssStatus}.${trackingNumber ? ` Tracking: ${trackingNumber}` : ""}`,
      actorRole: "SYSTEM",
      actorId: "SHIPSTATION_WEBHOOK",
      actorName: "ShipStation",
    };

    const updateFields: any = { status: nextStatus, updatedAt: now };
    if (trackingNumber) updateFields.trackingNumber = trackingNumber;
    if (carrier) updateFields.carrier = carrier;

    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId), status: (order as any).status },
      { $set: updateFields, $push: { statusTimeline: timelineEntry } }
    );

    publishOrderEvent(orderId, "order.status.changed", {
      orderId,
      status: nextStatus,
      from: currentStatus,
      to: nextStatus,
      trackingNumber: trackingNumber || (order as any).trackingNumber,
      carrier: carrier || (order as any).carrier,
      updatedAt: now,
      lastTimelineEntry: timelineEntry,
    });

    notifyAllAdmins({
      category: "orders",
      priority: nextStatus === "COMPLETED" ? "medium" : "low",
      title: nextStatus === "COMPLETED" ? "Order delivered" : "Order status updated",
      message:
        nextStatus === "COMPLETED"
          ? `Order #${displayId} delivered — confirmed by ShipStation.`
          : `Order #${displayId} → ${nextStatus} (ShipStation webhook).`,
      meta: { orderId, displayId, trackingNumber, status: nextStatus },
    }).catch(() => {});

    console.log(`[SS Webhook] ORDER_NOTIFY processed — order ${orderId} → ${nextStatus}`);
  }
}

export const shipStationWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const secret = env.shipStationWebhookSecret;
    if (!secret) {
      console.error(
        "[SHIPSTATION_WEBHOOK] refused: SHIPSTATION_WEBHOOK_SECRET is not set, so callers cannot be verified",
      );
      res.status(503).end();
      return;
    }

    const provided = String(req.query.token || "");
    /*
     * Length-independent comparison. `!==` on strings returns as soon as two
     * characters differ, and the timing of that is measurable over enough
     * requests — the token is a fixed secret, which is exactly the shape that
     * can be recovered a character at a time.
     */
    const providedBuf = Buffer.from(provided);
    const secretBuf = Buffer.from(secret);
    const tokenMatches =
      providedBuf.length === secretBuf.length && timingSafeEqual(providedBuf, secretBuf);

    if (!tokenMatches) {
      res.status(401).end();
      return;
    }

    const { resource_url, resource_type } = (req.body || {}) as SSWebhookBody;

    if (!resource_url || !resource_type) {
      // Malformed — respond 200 so ShipStation doesn't retry endlessly.
      res.status(200).end();
      return;
    }

    // Respond to ShipStation immediately so it doesn't time out.
    res.status(200).end();

    if (!isShipStationConfigured()) return;

    // Process in the background — don't let errors propagate to the already-sent response.
    (async () => {
      try {
        if (resource_type === "SHIP_NOTIFY") {
          await handleShipNotify(resource_url);
        } else if (resource_type === "ORDER_NOTIFY") {
          await handleOrderNotify(resource_url);
        } else {
          console.log(`[SS Webhook] Unhandled resource_type: ${resource_type}`);
        }
      } catch (err: any) {
        console.error(`[SS Webhook] Background processing failed (${resource_type}): ${err?.message}`);
      }
    })();
  } catch (error) {
    next(error);
  }
};
