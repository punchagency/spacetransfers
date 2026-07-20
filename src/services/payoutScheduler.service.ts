/**
 * Weekly Payout Draft Scheduler
 *
 * Runs every Friday at 09:00 UTC. It NEVER pays anyone automatically — it only
 * gathers each printer's eligible (unpaid) jobs into a `pending_review` payout
 * draft for an admin to review, approve, and manually process. This keeps the
 * "no automatic payments — explicit approval required" guarantee intact while
 * still saving the admin from assembling drafts by hand each week.
 *
 * Uses a simple setInterval-based cron — replace with node-cron or a job queue
 * in production.
 */

import { User } from "../models/user.model.js";
import { Payout } from "../models/payout.model.js";
import { getNextFridayDate, MINIMUM_PAYOUT_AMOUNT_CENTS } from "./stripe.service.js";
import { getEligibleJobsForPrinter } from "./partnerEarnings.service.js";
import { env } from "../config/env.js";
import mongoose from "mongoose";

const MINIMUM_PAYOUT_DOLLARS =
  (env.minimumPayoutAmountCents || MINIMUM_PAYOUT_AMOUNT_CENTS) / 100;

const log = (msg: string) =>
  console.log(`[PayoutScheduler ${new Date().toISOString()}] ${msg}`);

export async function runWeeklyPayouts(): Promise<void> {
  log("Starting weekly draft-generation run (no automatic payments)");

  const printers = await User.find({
    role: "PRINTER",
    payoutsEnabled: { $ne: false },
  }).lean();

  log(`Found ${printers.length} printers with payouts enabled`);

  for (const printer of printers) {
    try {
      await createPrinterPayoutDraft(printer);
    } catch (err: any) {
      log(`ERROR drafting payout for printer ${printer._id}: ${err.message}`);
    }
  }

  log("Weekly draft-generation run complete");
}

async function createPrinterPayoutDraft(printer: any): Promise<void> {
  const printerId = printer._id;

  // getEligibleJobsForPrinter already excludes jobs reserved by an existing
  // (non-rejected/non-cancelled) payout, so re-running is safe and never
  // double-drafts the same jobs.
  const { jobs, total } = await getEligibleJobsForPrinter(printerId.toString());

  if (jobs.length === 0 || total < MINIMUM_PAYOUT_DOLLARS) {
    log(
      `Skipping printer ${printerId} — eligible balance $${total.toFixed(2)} below minimum $${MINIMUM_PAYOUT_DOLLARS} (or no jobs)`
    );
    return;
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
}

/**
 * Schedule the weekly Friday payout job.
 * Checks every minute if it's Friday 09:00 UTC and hasn't run today yet.
 */
let lastRunDate: string | null = null;

export function scheduleFridayPayouts(): void {
  log("Payout scheduler initialized — will run every Friday at 09:00 UTC");

  setInterval(async () => {
    const now = new Date();
    const isFriday = now.getUTCDay() === 5;
    const isPayoutHour = now.getUTCHours() === 9 && now.getUTCMinutes() < 5;
    const todayKey = now.toISOString().split("T")[0];

    if (isFriday && isPayoutHour && lastRunDate !== todayKey) {
      lastRunDate = todayKey;
      try {
        await runWeeklyPayouts();
      } catch (err: any) {
        log(`Unhandled error in weekly payout run: ${err.message}`);
      }
    }
  }, 60_000); // check every minute
}
