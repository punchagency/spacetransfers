import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { env } from "../config/env.js";
import { publishOrderEvent } from "./orderSyncHub.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { getShipmentTracking, isDeliveredStatus, isShipStationConfigured } from "./shipstation.service.js";

// ── Exported pure helper — lets tests verify the filter logic without a DB ────

export const shouldPollOrder = (order: {
  status: string;
  trackingNumber?: string | null;
  createdAt: Date;
  maxPollingDays: number;
}): boolean => {
  if (order.status !== "SHIPPED") return false;
  if (!order.trackingNumber) return false;
  const ageDays =
    (Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= order.maxPollingDays;
};

// ── Single poll cycle ─────────────────────────────────────────────────────────

export const pollDeliveredOrders = async (): Promise<void> => {
  if (!isShipStationConfigured()) return;

  const cutoff = new Date(
    Date.now() - env.shipStationMaxPollingDays * 24 * 60 * 60 * 1000
  );

  const shippedOrders = await Order.find({
    status: "SHIPPED",
    trackingNumber: { $ne: null, $exists: true },
    createdAt: { $gte: cutoff },
  })
    .select("_id displayId trackingNumber shipStationOrderId customer")
    .lean();

  if (shippedOrders.length === 0) return;

  console.log(`[POLLER] Checking ${shippedOrders.length} SHIPPED order(s) for delivery`);

  for (const order of shippedOrders) {
    const orderId = String(order._id);
    const displayId = String(
      (order as any).displayId ?? String(order._id).slice(-6).toUpperCase()
    );

    try {
      const { status, deliveredAt } = await getShipmentTracking({
        trackingNumber: String((order as any).trackingNumber),
        orderNumber: displayId,
      });

      if (!isDeliveredStatus(status)) continue;

      const now = new Date();
      const deliveredTime = deliveredAt ?? now;
      const timelineEntry = {
        status: "COMPLETED",
        time: now,
        message: `Delivery confirmed by carrier. Delivered at: ${deliveredTime.toISOString()}`,
        actorRole: "SYSTEM",
        actorId: "TRACKING_POLLER",
        actorName: "Auto-Tracking",
      };

      // Idempotent update: only transitions from SHIPPED → COMPLETED.
      // findOneAndUpdate returns null if the order was already COMPLETED by
      // another process, preventing duplicate timeline entries.
      const updated = await Order.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(orderId), status: "SHIPPED" },
        {
          $set: { status: "COMPLETED", updatedAt: now },
          $push: { statusTimeline: timelineEntry },
        },
        { new: false }
      );

      if (!updated) {
        // Status was changed by another process between our find and this update.
        continue;
      }

      // Fire customer SSE.
      publishOrderEvent(orderId, "order.status.changed", {
        orderId,
        status: "COMPLETED",
        from: "SHIPPED",
        to: "COMPLETED",
        updatedAt: now,
        lastTimelineEntry: timelineEntry,
      });

      notifyAllAdmins({
        category: "orders",
        priority: "medium",
        title: "Order delivered",
        message: `Order #${displayId} has been delivered and marked Completed.`,
        meta: {
          orderId,
          displayId,
          trackingNumber: String((order as any).trackingNumber),
          deliveredAt: deliveredTime.toISOString(),
        },
      }).catch(() => {});

      console.log(`[POLLER] Order ${orderId} (${displayId}) → COMPLETED (delivered)`);
    } catch (err: any) {
      // Log per-order failures so one bad tracking number doesn't stop the whole cycle.
      console.error(
        `[POLLER] Failed to check tracking for order ${orderId}: ${err?.message}`
      );
    }
  }
};

// ── Poller lifecycle ──────────────────────────────────────────────────────────

let pollerTimer: ReturnType<typeof setInterval> | null = null;

export const startTrackingPoller = (
  intervalMs = env.shipStationPollIntervalMs
): void => {
  if (pollerTimer !== null) return; // already running

  // Run once immediately on startup, then on the configured interval.
  pollDeliveredOrders().catch((err: any) =>
    console.error(`[POLLER] Initial poll failed: ${err?.message}`)
  );

  pollerTimer = setInterval(() => {
    pollDeliveredOrders().catch((err: any) =>
      console.error(`[POLLER] Poll cycle failed: ${err?.message}`)
    );
  }, intervalMs);

  // Don't block process exit for the interval timer.
  if (pollerTimer.unref) pollerTimer.unref();

  console.log(
    `[POLLER] Tracking poller started — interval: ${Math.round(intervalMs / 60_000)} min, ` +
    `max age: ${env.shipStationMaxPollingDays} days`
  );
};

export const stopTrackingPoller = (): void => {
  if (pollerTimer !== null) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
};
