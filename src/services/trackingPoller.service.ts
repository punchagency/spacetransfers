import { Order } from "../models/order.model.js";
import { env } from "../config/env.js";
import { createTracker, isEasyPostConfigured, retrieveTracker } from "./easypost.service.js";
import { applyTrackerUpdate } from "./shippingLabel.service.js";
import { reportJobError } from "./monitoring.service.js";

/**
 * Checks parcels with the carrier, as a backup to EasyPost's webhooks.
 *
 * A webhook can be missed (the API down when it was sent, the endpoint not yet
 * registered), so every so often each order with a label that hasn't been
 * delivered is looked up. An order that ships is moved on and a delivered one
 * completed, exactly as a webhook would have done.
 */

/** Whether an order is still worth asking the carrier about. */
export const shouldPollOrder = (order: {
  status: string;
  trackingNumber?: string | null;
  createdAt: Date;
  maxPollingDays: number;
}): boolean => {
  if (order.status !== "SHIPPED" && order.status !== "QUALITY_CHECK") return false;
  if (!order.trackingNumber) return false;
  const ageDays = (Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= order.maxPollingDays;
};

export const pollShippedOrders = async (): Promise<void> => {
  if (!isEasyPostConfigured()) return;
  const cutoff = new Date(Date.now() - env.trackingMaxPollingDays * 24 * 60 * 60 * 1000);
  const orders = await Order.find({
    status: { $in: ["SHIPPED", "QUALITY_CHECK"] },
    trackingNumber: { $type: "string", $ne: "" },
    createdAt: { $gte: cutoff },
  })
    .select("_id displayId status trackingNumber carrier easyPostTrackerId trackingUrl trackingStatus assignedPrinter")
    .lean();
  if (orders.length === 0) return;

  for (const order of orders as any[]) {
    try {
      // A tracking number with no tracker (a label from before EasyPost) gets one now.
      const tracker = order.easyPostTrackerId
        ? await retrieveTracker(String(order.easyPostTrackerId))
        : await createTracker(String(order.trackingNumber), order.carrier || null);
      await applyTrackerUpdate(order, tracker, "poller");
    } catch (err: any) {
      console.error(`[TRACKING] order ${order.displayId || order._id}: ${err?.message}`);
    }
  }
};

let pollerTimer: ReturnType<typeof setInterval> | null = null;

export const startTrackingPoller = (intervalMs = env.trackingPollIntervalMs): void => {
  if (pollerTimer !== null) return;
  const run = () => pollShippedOrders().catch((err: any) => reportJobError("TRACKING", err));
  run();
  pollerTimer = setInterval(run, intervalMs);
  if (pollerTimer.unref) pollerTimer.unref();
  console.log(`[TRACKING] poller started: every ${Math.round(intervalMs / 60_000)} min, orders up to ${env.trackingMaxPollingDays} days old`);
};

export const stopTrackingPoller = (): void => {
  if (pollerTimer !== null) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
};
