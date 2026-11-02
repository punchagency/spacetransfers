/**
 * Weekly Payout Draft Scheduler
 *
 * Runs every Friday at 09:00 UTC. It NEVER pays anyone automatically — it only
 * gathers each printer's eligible (unpaid) jobs into a `pending_review` payout
 * draft for an admin to review, approve, and manually process. This keeps the
 * "no automatic payments — explicit approval required" guarantee intact while
 * still saving the admin from assembling drafts by hand each week.
 *
 * Checked every minute. It runs at the first check from Friday 09:00 UTC to the
 * end of Friday, so a server that was asleep or restarting at 09:00 still
 * drafts that week; running twice is harmless because drafted jobs are reserved.
 */

import { User } from "../models/user.model.js";
import { Payout } from "../models/payout.model.js";
import { getNextFridayDate, MINIMUM_PAYOUT_AMOUNT_CENTS } from "./stripe.service.js";
import { getEligibleJobsForPrinter } from "./partnerEarnings.service.js";
import { env } from "../config/env.js";
import mongoose from "mongoose";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { reportJobError } from "./monitoring.service.js";

const MINIMUM_PAYOUT_DOLLARS =
  (env.minimumPayoutAmountCents || MINIMUM_PAYOUT_AMOUNT_CENTS) / 100;

const log = (msg: string) =>
  console.log(`[PayoutScheduler ${new Date().toISOString()}] ${msg}`);

export async function runWeeklyPayouts(): Promise<{ drafted: number; total: number }> {
  log("Starting weekly draft-generation run (no automatic payments)");

  const printers = await User.find({
    role: "PRINTER",
    payoutsEnabled: { $ne: false },
  }).lean();

  log(`Found ${printers.length} printers with payouts enabled`);

  let drafted = 0;
  let total = 0;
  for (const printer of printers) {
    try {
      const amount = await createPrinterPayoutDraft(printer);
      if (amount !== null) {
        drafted += 1;
        total += amount;
      }
    } catch (err: any) {
      reportJobError("PAYOUT_DRAFTS", err);
    }
  }

  log("Weekly draft-generation run complete");
  if (drafted > 0) {
    // Nothing is paid until an admin does it, so they need to know the drafts are there.
    notifyAllAdmins({
      category: "partners",
      priority: "medium",
      title: drafted === 1 ? "A payout is ready for review" : `${drafted} payouts are ready for review`,
      message: `This week's partner payouts ($${total.toFixed(2)} in all) are waiting in Payouts. Approve and pay each one there.`,
      meta: { type: "payout_drafts" },
    }).catch(() => {});
  }
  return { drafted, total };
}

/** The draft's amount, or null when this partner has nothing to draft. */
async function createPrinterPayoutDraft(printer: any): Promise<number | null> {
  const printerId = printer._id;

  // getEligibleJobsForPrinter already excludes jobs reserved by an existing
  // (non-rejected/non-cancelled) payout, so re-running is safe and never
  // double-drafts the same jobs.
  const { jobs, total } = await getEligibleJobsForPrinter(printerId.toString());

  if (jobs.length === 0 || total < MINIMUM_PAYOUT_DOLLARS) {
    log(
      `Skipping printer ${printerId} — eligible balance $${total.toFixed(2)} below minimum $${MINIMUM_PAYOUT_DOLLARS} (or no jobs)`
    );
    return null;
  }

  const payout = await Payout.create({
    printerId,
    amount: total,
    currency: "usd",
    status: "pending_review",
    scheduledDate: getNextFridayDate(),
    orderIds: jobs.map((j) => new mongoose.Types.ObjectId(j.orderId)),
    lineItems: jobs.map((j) => ({
      orderId: new mongoose.Types.ObjectId(j.orderId),
      displayId: j.displayId,
      orderNumber: j.orderNumber,
      customerName: j.customerName,
      jobStatus: j.jobStatus,
      completedAt: j.completedAt ? new Date(j.completedAt) : null,
      amount: j.amount,
    })),
    createdByName: "System (weekly draft)",
    statusHistory: [
      {
        status: "pending_review",
        at: new Date(),
        changedBy: null,
        changedByName: "System (weekly draft)",
        note: `Auto-drafted from ${jobs.length} eligible job(s)`,
      },
    ],
    metadata: { trigger: "weekly_cron" },
  });

  log(
    `Drafted payout ${payout._id} for printer ${printerId} — $${total.toFixed(2)} (${jobs.length} jobs), awaiting admin review`
  );
  return total;
}

/** Whether this minute's check should draft: any time on Friday from 09:00 UTC, once a day. */
export const isPayoutDraftDue = (now: Date, lastRunDate: string | null): boolean =>
  now.getUTCDay() === 5 && now.getUTCHours() >= 9 && lastRunDate !== now.toISOString().slice(0, 10);

let lastRunDate: string | null = null;

export function scheduleFridayPayouts(): void {
  log("Payout scheduler initialized — will run every Friday at 09:00 UTC");

  setInterval(async () => {
    const now = new Date();
    if (isPayoutDraftDue(now, lastRunDate)) {
      lastRunDate = now.toISOString().slice(0, 10);
      try {
        await runWeeklyPayouts();
      } catch (err: any) {
        reportJobError("PAYOUT_DRAFTS", err);
      }
    }
  }, 60_000); // check every minute
}
