import mongoose from "mongoose";
import { Order } from "../models/order.model.js";

/**
 * How a partner has actually performed, derived from their orders.
 *
 * Extracted so the two consoles cannot disagree about the same partner. The
 * admin's partner page computed this inline; the partner's own Profile page
 * read `user.performance` — a stored object that **nothing in the server ever
 * writes**. It is `{completionRate: 0, responseTime: 0, customerRating: 0}` on
 * every partner in the database, and the UI dressed those zeros up as
 * measurements: "< 2 hours" response time, "Top 10%" beside a 0m average.
 *
 * So a partner was shown invented numbers about themselves while an admin
 * looking at the same partner saw real ones. Both sides read this now.
 *
 * Measured to SHIPPED rather than COMPLETED because COMPLETED is set by
 * delivery confirmation from the carrier, which is not the partner's doing.
 */

export interface PartnerPerformance {
  /** Mean hours from assignment to shipping. Null when nothing has shipped. */
  averageProductionHours: number | null;
  /** Percentage shipped by their deadline. Null when no deadline was recorded. */
  onTimeDeliveryRate: number | null;
  /** How many finished jobs the average is drawn from. */
  sampleSize: number;
  /** How many of their jobs carried a deadline to be judged against. */
  deadlineSampleSize: number;
}

/** The moment this order reached SHIPPED, or null if it never did. */
const shippedAtOf = (o: any): Date | null => {
  const entries = Array.isArray(o.statusTimeline) ? o.statusTimeline : [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (String(entries[i]?.status || "").toUpperCase() === "SHIPPED") {
      const t = new Date(entries[i].time);
      return Number.isNaN(t.getTime()) ? null : t;
    }
  }
  return null;
};

export const computePartnerPerformance = async (partnerId: string): Promise<PartnerPerformance> => {
  const id = mongoose.Types.ObjectId.isValid(String(partnerId))
    ? new mongoose.Types.ObjectId(String(partnerId))
    : null;
  if (!id) {
    return { averageProductionHours: null, onTimeDeliveryRate: null, sampleSize: 0, deadlineSampleSize: 0 };
  }

  const shippedOrders = await Order.find({
    assignedPrinter: id,
    status: { $in: ["SHIPPED", "COMPLETED"] },
    assignedAt: { $ne: null },
  })
    .select("assignedAt assignmentDeadline statusTimeline")
    .lean();

  const durationsMs: number[] = [];
  let onTime = 0;
  let deadlineKnown = 0;

  for (const o of shippedOrders) {
    const shippedAt = shippedAtOf(o);
    if (!shippedAt) continue;
    const assignedAt = new Date((o as any).assignedAt);
    if (Number.isNaN(assignedAt.getTime())) continue;

    const ms = shippedAt.getTime() - assignedAt.getTime();
    // A negative span means the timeline and the assignment stamp disagree —
    // usually a reassignment. Counting it would drag the average below zero.
    if (ms >= 0) durationsMs.push(ms);

    const deadline = (o as any).assignmentDeadline ? new Date((o as any).assignmentDeadline) : null;
    if (deadline && !Number.isNaN(deadline.getTime())) {
      deadlineKnown += 1;
      if (shippedAt <= deadline) onTime += 1;
    }
  }

  // Null, not zero: no finished jobs is "nothing to measure yet", and a 0%
  // on-time rate would read as a partner who never delivers on time.
  return {
    averageProductionHours: durationsMs.length
      ? Number((durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / 3600000).toFixed(1))
      : null,
    onTimeDeliveryRate: deadlineKnown ? Number(((onTime / deadlineKnown) * 100).toFixed(1)) : null,
    sampleSize: durationsMs.length,
    deadlineSampleSize: deadlineKnown,
  };
};
