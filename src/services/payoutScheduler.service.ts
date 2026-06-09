/**
 * Friday Payout Scheduler (TEST MODE ONLY)
 * Runs every Friday at 09:00 UTC to process automated Stripe Connect payouts.
 * Uses a simple setInterval-based cron — replace with node-cron or a job queue in production.
 */

import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import {
  processPayoutTransfer,
  getNextFridayDate,
  MINIMUM_PAYOUT_AMOUNT_CENTS,
} from "./stripe.service.js";
import { env } from "../config/env.js";

const MINIMUM_PAYOUT_DOLLARS =
  (env.minimumPayoutAmountCents || MINIMUM_PAYOUT_AMOUNT_CENTS) / 100;

const log = (msg: string) =>
  console.log(`[PayoutScheduler ${new Date().toISOString()}] ${msg}`);

const calcOrderEarning = (order: any): number => {
  const items: any[] = Array.isArray(order.items) ? order.items : [];
  return items.reduce((s: number, item: any) => {
    const unitCost = item.partnerCost || item.unitCost || 0;
    return s + unitCost * (item.quantity || 1);
  }, 0);
};

export async function runWeeklyPayouts(): Promise<void> {
  log("Starting weekly Friday payout run (TEST MODE)");

  const printers = await User.find({
    role: "PRINTER",
    stripeConnectAccountId: { $ne: null },
    stripeConnectOnboarded: true,
    payoutsEnabled: true,
  }).lean();

  log(`Found ${printers.length} eligible printers`);

  for (const printer of printers) {
    try {
      await processPrinterPayout(printer);
    } catch (err: any) {
      log(`ERROR processing printer ${printer._id}: ${err.message}`);
    }
  }

  log("Weekly payout run complete");
}

async function processPrinterPayout(printer: any): Promise<void> {
  const printerId = printer._id;

  // Find completed orders not yet covered by a paid/processing payout
  const existingPaidPayouts = await Payout.find({
    printerId,
    status: { $in: ["processing", "paid"] },
  }).lean();
  const coveredOrderIds = new Set(
    existingPaidPayouts.flatMap((p) => p.orderIds.map((id) => id.toString()))
  );

  const eligibleOrders = await Order.find({
    assignedPrinter: printerId,
    status: { $in: ["SHIPPED", "COMPLETED"] },
  }).lean();

  const unpaidOrders = eligibleOrders.filter(
    (o) => !coveredOrderIds.has(o._id.toString())
  );

  const totalAmount = unpaidOrders.reduce(
    (s, o) => s + calcOrderEarning(o),
    0
  );

  if (totalAmount < MINIMUM_PAYOUT_DOLLARS) {
    log(
      `Skipping printer ${printerId} — balance $${totalAmount.toFixed(2)} below minimum $${MINIMUM_PAYOUT_DOLLARS}`
    );
    return;
  }

  const scheduledDate = getNextFridayDate();
  const payout = await Payout.create({
    printerId,
    amount: Number(totalAmount.toFixed(2)),
    currency: "usd",
    status: "processing",
    scheduledDate,
    orderIds: unpaidOrders.map((o) => o._id),
    metadata: { mode: "test", trigger: "weekly_cron" },
  });

  log(
    `Processing payout ${payout._id} for printer ${printerId} — $${totalAmount.toFixed(2)}`
  );

  try {
    const amountCents = Math.round(totalAmount * 100);
    const { transfer, payout: stripePayout } = await processPayoutTransfer(
      printer.stripeConnectAccountId,
      amountCents,
      payout._id.toString(),
      printerId.toString()
    );

    payout.stripeTransferId = transfer.id;
    payout.stripePayoutId = stripePayout.id;
    payout.status = "paid";
    payout.processedAt = new Date();
    await payout.save();

    log(`Payout ${payout._id} succeeded — Stripe transfer ${transfer.id}`);
  } catch (stripeErr: any) {
    payout.status = "failed";
    payout.failureReason = stripeErr?.message || "Stripe transfer failed";
    await payout.save();

    log(`Payout ${payout._id} FAILED — ${payout.failureReason}`);
  }
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
