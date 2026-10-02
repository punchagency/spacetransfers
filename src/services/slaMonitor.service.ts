import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { getAssignmentSettings } from "./partnerCapacity.service.js";
import { autoAssignOrder } from "./orderAssignment.service.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import {
    evaluateSla,
  resolveBreachAction,
  slaReassignmentCount,
} from "../utils/slaStages.js";

/**
 * Acts on jobs that have missed their stage deadline.
 *
 * The requeue path here is deliberately the same one a partner's own
 * cancellation uses: `$unset assignedPrinter`, status back to PENDING, and
 * `cancelledByPrinterId` recorded — which `autoAssignOrder` already reads to
 * keep that partner out of the candidate pool. Building a second requeue would
 * have meant two ways to release a job that could drift apart.
 *
 * Every decision about *whether* to act lives in `utils/slaStages`, which is
 * pure. This file only queries and executes.
 */

export interface SlaSweepResult {
  scanned: number;
  reassigned: number;
  escalated: number;
  skipped: number;
}

const displayOf = (order: any) =>
  String(order?.displayId || String(order?._id).slice(-6).toUpperCase());

/**
 * Broadcast, unlike the sign-in alerts that were narrowed to one admin: a job
 * stuck in production is an operational event with no particular owner, and it
 * needs whoever is on shift rather than whoever happens to hold the account.
 */
const escalate = async (order: any, reason: string) => {
  await notifyAllAdmins({
    title: "Order missed its deadline",
    message: `${displayOf(order)} — ${reason}`,
    category: "orders",
    priority: "high",
    meta: { type: "sla_breach", orderId: String(order._id) },
  }).catch(() => {});
};

const releaseAndReassign = async (order: any, reason: string) => {
  const now = new Date();
  const printerId = order.assignedPrinter?._id ?? order.assignedPrinter;
  const printerName = String(
    order.assignedPrinter?.companyName || order.assignedPrinter?.name || "the partner",
  );

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        status: "PENDING",
        returnedAt: now,
        cancelledByPrinterId: printerId ? new mongoose.Types.ObjectId(String(printerId)) : undefined,
        cancelledByPrinterName: printerName,
        updatedAt: now,
      },
      $unset: { assignedPrinter: "" },
      $push: {
        statusTimeline: {
          status: "PENDING",
          message: reason,
          actorRole: "SYSTEM",
          actorName: "SLA monitor",
          time: now,
        },
        assignmentHistory: {
          time: now,
          mode: "AUTO",
          selectedPrinterId: null,
          selectedPrinterName: null,
          reason,
          tookMs: 0,
        },
      },
    },
  );

  // Told before the job moves on, because it changes their queue and their pay.
  if (printerId) {
    notifyPrinter({
      printerId: String(printerId),
      category: "orders",
      priority: "high",
      title: "Order returned to the queue",
      message: `${displayOf(order)} was not started in time and has gone back to the queue.`,
      meta: { type: "sla_reassigned", orderId: String(order._id) },
      settingsKey: "orderUpdates",
    }).catch(() => {});
  }

  const result = await autoAssignOrder(String(order._id));

  /*
   * A release that finds no new home leaves the order unassigned rather than
   * back where it was — so it must be raised, or it sits in PENDING silently
   * while the customer waits.
   */
  if (!result?.assigned) {
    await escalate(
      order,
      `${reason}, and no other partner could take it (${result?.reason || "no candidates"})`,
    );
  }

  return Boolean(result?.assigned);
};

/** One pass. Returns what it did, so the caller can log a single line. */
export const runSlaSweep = async (now: Date = new Date()): Promise<SlaSweepResult> => {
  const out: SlaSweepResult = { scanned: 0, reassigned: 0, escalated: 0, skipped: 0 };

  const { sla } = await getAssignmentSettings();
  if (!sla.enabled) return out;

  const orders = await Order.find({ status: { $in: ["PROCESSING", "PRINTING"] } })
    .populate("assignedPrinter", "companyName name")
    .select("displayId status priority assignedAt assignmentDeadline assignedPrinter statusTimeline assignmentHistory")
    .lean(false);

  for (const order of orders) {
    out.scanned += 1;

    const breach = evaluateSla(order as any, sla, now);
    if (!breach) continue;

    const { action, reason } = resolveBreachAction(
      breach,
      slaReassignmentCount(order as any),
      sla,
    );

    try {
      if (action === "REASSIGN") {
        const moved = await releaseAndReassign(order, reason);
        if (moved) out.reassigned += 1;
        else out.escalated += 1;
      } else {
        await escalate(order, reason);
        out.escalated += 1;
      }
    } catch (error: any) {
      out.skipped += 1;
      console.error(`[SLA] ${displayOf(order)} could not be actioned:`, error?.message || error);
    }
  }

  if (out.reassigned || out.escalated) {
    console.log(
      `[SLA] swept ${out.scanned} in-flight order(s) — ` +
        `${out.reassigned} reassigned, ${out.escalated} escalated, ${out.skipped} failed`,
    );
  }
  return out;
};

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Runs on an interval, matching the payout scheduler and tracking poller rather
 * than introducing a different mechanism. Reads its settings each pass, so
 * enabling the SLA in the console takes effect without a restart.
 */
export const startSlaMonitor = (intervalMs = 15 * 60 * 1000): void => {
  if (timer) return;
  timer = setInterval(() => {
    runSlaSweep().catch((e) => console.error("[SLA] sweep failed:", e?.message || e));
  }, intervalMs);
  console.log(`[SLA] monitor started — sweeping every ${Math.round(intervalMs / 60000)} min`);
};

export const stopSlaMonitor = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
