import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import {
  stripe,
  createConnectAccount,
  createConnectAccountLink,
  getConnectAccount,
  processPayoutTransfer,
  getNextFridayDate,
  MINIMUM_PAYOUT_AMOUNT_CENTS,
  assertStripeConfigured,
  isStripeConfigured
} from "../services/stripe.service.js";
import { env } from "../config/env.js";
import mongoose from "mongoose";
import {
  getEligibleJobsForPrinter,
  RESERVING_PAYOUT_STATUSES,
} from "../services/partnerEarnings.service.js";
import { notifyPrinter } from "../services/printerNotifications.service.js";
import type { IPayout, PayoutStatus } from "../models/payout.model.js";

interface CustomError extends Error {
  statusCode?: number;
}

/** Append an audit entry to a payout's status history (mutates, does not save). */
const recordStatusChange = (
  payout: IPayout,
  status: PayoutStatus,
  req: Request,
  note?: string | null,
) => {
  if (!Array.isArray(payout.statusHistory)) payout.statusHistory = [];
  payout.statusHistory.push({
    status,
    at: new Date(),
    changedBy: req.user?.id ? new mongoose.Types.ObjectId(String(req.user.id)) : null,
    changedByName: (req.user as any)?.name || (req.user as any)?.email || "Admin",
    note: note ?? null,
  });
};

// ─── PRINTER: Stripe Connect onboarding ───────────────────────────────────────

export const createStripeConnectAccount = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Checked before any Stripe call, so an unset key is reported as "not set
    // up yet" instead of arriving as an upstream 401.
    assertStripeConfigured();

    const printerId = req.user?.id;
    const printer = await User.findById(printerId);
    if (!printer) {
      const e = new Error("Printer not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }

    let accountId = printer.stripeConnectAccountId;

    if (!accountId) {
      accountId = await createConnectAccount(printer.email);
      printer.stripeConnectAccountId = accountId;
      await printer.save();
    }

    /*
     * 5175, not 5174. The fallback pointed at the ADMIN app, so with
     * PRINTER_APP_URL unset a partner finishing Stripe onboarding was returned
     * to a console they cannot sign in to.
     */
    const printerUrl = env.printerAppUrl || "http://localhost:5175";
    const url = await createConnectAccountLink(
      accountId,
      `${printerUrl}/settings?stripe=refresh`,
      `${printerUrl}/settings?stripe=success`
    );

    res.json({ url, accountId });
  } catch (err) {
    next(err);
  }
};

export const getStripeConnectStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const printerId = req.user?.id;
    const printer = await User.findById(printerId).select(
      "stripeConnectAccountId stripeConnectOnboarded payoutsEnabled email"
    );
    if (!printer) {
      const e = new Error("Printer not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }

    if (!printer.stripeConnectAccountId) {
      return res.json({
        connected: false,
        onboarded: false,
        payoutsEnabled: false,
        accountId: null,
        details: null,
        // So the page can say why the button will not work, rather than
        // offering it and failing on click.
        configured: isStripeConfigured(),
      });
    }

    // A partner who connected while Stripe was configured must not have their
    // status reported as broken if the key is later removed.
    assertStripeConfigured();

    const account = await getConnectAccount(printer.stripeConnectAccountId);
    const onboarded =
      account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled;

    if (onboarded && !printer.stripeConnectOnboarded) {
      printer.stripeConnectOnboarded = true;
      await printer.save();
    }

    res.json({
      connected: true,
      onboarded: !!onboarded,
      payoutsEnabled: printer.payoutsEnabled !== false,
      accountId: printer.stripeConnectAccountId,
      details: {
        email: account.email,
        country: account.country,
        defaultCurrency: account.default_currency,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PRINTER: Earnings summary (Stripe-aware) ─────────────────────────────────

export const getPrinterPayoutSummary = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const printerId = req.user?.id;
    const printer = await User.findById(printerId).select(
      "settings.pricing stripeConnectAccountId stripeConnectOnboarded payoutsEnabled"
    );
    if (!printer) {
      const e = new Error("Printer not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }

    // Aggregate completed (paid-out) orders
    const completedOrders = await Order.find({
      assignedPrinter: printerId,
      status: { $in: ["SHIPPED", "COMPLETED"] },
    }).lean();

    // Pending orders (not yet paid out)
    const pendingOrders = await Order.find({
      assignedPrinter: printerId,
      status: {
        $nin: ["SHIPPED", "COMPLETED", "CANCELLED", "REJECTED"],
      },
    }).lean();

    const calcEarning = (order: any): number => {
      const items: any[] = Array.isArray(order.items) ? order.items : [];
      const fromItems = items.reduce((s: number, item: any) => {
        const sub = typeof item.subtotal === "number"
          ? item.subtotal
          : (typeof item.unitPrice === "number" ? item.unitPrice * (item.quantity || 1) : 0);
        return s + sub;
      }, 0);
      if (fromItems > 0) return fromItems;
      // Fall back to stored pricing subtotal if items lack prices
      return typeof order.pricing?.subtotal === "number"
        ? order.pricing.subtotal
        : (typeof order.pricing?.total === "number" ? order.pricing.total : 0);
    };

    const totalEarnings = [...completedOrders, ...pendingOrders].reduce(
      (s, o) => s + calcEarning(o),
      0
    );
    const paidOutAmount = completedOrders.reduce(
      (s, o) => s + calcEarning(o),
      0
    );
    const pendingEarnings = pendingOrders.reduce(
      (s, o) => s + calcEarning(o),
      0
    );

    // Available balance = completed orders not yet in a paid payout
    const alreadyPaidPayouts = await Payout.find({
      printerId,
      status: { $in: ["processing", "paid"] },
    }).lean();
    const alreadyPaidOrderIds = new Set(
      alreadyPaidPayouts.flatMap((p) => p.orderIds.map((id) => id.toString()))
    );
    const availableOrders = completedOrders.filter(
      (o) => !alreadyPaidOrderIds.has(o._id.toString())
    );
    const availableBalance = availableOrders.reduce(
      (s, o) => s + calcEarning(o),
      0
    );

    const nextPayoutDate = getNextFridayDate();

    res.json({
      totalEarnings: Number(totalEarnings.toFixed(2)),
      availableBalance: Number(availableBalance.toFixed(2)),
      pendingEarnings: Number(pendingEarnings.toFixed(2)),
      paidOutAmount: Number(paidOutAmount.toFixed(2)),
      nextScheduledPayoutDate: nextPayoutDate.toISOString(),
      stripeConnected: !!printer.stripeConnectAccountId,
      stripeOnboarded: !!printer.stripeConnectOnboarded,
      payoutsEnabled: printer.payoutsEnabled !== false,
      minimumPayoutAmount: (env.minimumPayoutAmountCents || MINIMUM_PAYOUT_AMOUNT_CENTS) / 100,
    });
  } catch (err) {
    next(err);
  }
};

export const getPrinterPayoutHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const printerId = req.user?.id;
    const { page = "1", limit = "20", status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = { printerId };
    if (status && status !== "all") filter.status = status;

    const [payouts, total] = await Promise.all([
      Payout.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Payout.countDocuments(filter),
    ]);

    res.json({
      payouts: payouts.map((p) => ({
        id: p._id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        scheduledDate: p.scheduledDate,
        processedAt: p.processedAt,
        stripeTransferId: p.stripeTransferId,
        retryCount: p.retryCount,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
      })),
      pagination: { total, page: Number(page), limit: Number(limit) },
    });
  } catch (err) {
    next(err);
  }
};

export const exportPrinterPayouts = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const printerId = req.user?.id;
    const payouts = await Payout.find({ printerId })
      .sort({ createdAt: -1 })
      .lean();

    const rows = [
      ["Payout ID", "Amount", "Currency", "Status", "Scheduled Date", "Processed At", "Stripe Transfer ID", "Retry Count", "Failure Reason"].join(","),
      ...payouts.map((p) =>
        [
          p._id.toString(),
          p.amount.toFixed(2),
          p.currency.toUpperCase(),
          p.status,
          new Date(p.scheduledDate).toISOString(),
          p.processedAt ? new Date(p.processedAt).toISOString() : "",
          p.stripeTransferId || "",
          p.retryCount,
          `"${(p.failureReason || "").replace(/"/g, "'")}"`,
        ].join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payout-history-${Date.now()}.csv"`
    );
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: Payout management ─────────────────────────────────────────────────

export const adminListPayouts = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page = "1", limit = "20", status, printerId: printerFilter } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = {};
    if (status && status !== "all") filter.status = status;
    if (printerFilter) filter.printerId = printerFilter;

    const [payouts, total] = await Promise.all([
      Payout.find(filter)
        .populate("printerId", "name email companyName stripeConnectAccountId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Payout.countDocuments(filter),
    ]);

    res.json({ payouts, pagination: { total, page: Number(page), limit: Number(limit) } });
  } catch (err) {
    next(err);
  }
};

export const adminGetPayoutStats = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const [pendingReview, approved, processing, paid, rejected, failed] = await Promise.all([
      // Treat the legacy "pending" as pending_review for the count.
      Payout.countDocuments({ status: { $in: ["pending_review", "pending"] } }),
      Payout.countDocuments({ status: "approved" }),
      Payout.countDocuments({ status: "processing" }),
      Payout.countDocuments({ status: "paid" }),
      Payout.countDocuments({ status: "rejected" }),
      Payout.countDocuments({ status: "failed" }),
    ]);

    const [totalPaidAgg] = await Payout.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // "Awaiting payment" value = everything approved/processing but not yet paid.
    const [pendingAgg] = await Payout.aggregate([
      { $match: { status: { $in: ["pending_review", "pending", "approved", "processing"] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    res.json({
      counts: { pendingReview, approved, processing, paid, rejected, failed },
      amounts: {
        totalPaid: totalPaidAgg?.total || 0,
        totalPending: pendingAgg?.total || 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Initiate the actual Stripe transfer for an already-approved (or retrying)
 * payout and record the outcome + audit trail. Mutates & saves the payout.
 * This is the ONLY place a real payment is initiated, and it is only ever
 * reached from an explicit admin action — never automatically.
 */
const runPayoutTransfer = async (payout: IPayout, req: Request): Promise<void> => {
  const printer = await User.findById(payout.printerId).select(
    "stripeConnectAccountId stripeConnectOnboarded payoutsEnabled email name companyName"
  );
  if (!printer || !printer.stripeConnectAccountId) {
    const e = new Error("Printer has no Stripe Connect account") as CustomError;
    e.statusCode = 400;
    throw e;
  }
  if (printer.payoutsEnabled === false) {
    const e = new Error("Payouts are disabled for this printer") as CustomError;
    e.statusCode = 400;
    throw e;
  }

  payout.status = "processing";
  payout.failureReason = null;
  recordStatusChange(payout, "processing", req, "Payment initiated");
  await payout.save();

  try {
    const amountCents = Math.round(payout.amount * 100);
    const { transfer, payout: stripePayout } = await processPayoutTransfer(
      printer.stripeConnectAccountId,
      amountCents,
      payout._id.toString(),
      payout.printerId.toString()
    );

    payout.stripeTransferId = transfer.id;
    payout.stripePayoutId = stripePayout.id;
    payout.status = "paid";
    payout.processedAt = new Date();
    recordStatusChange(payout, "paid", req, `Stripe transfer ${transfer.id}`);
    await payout.save();

    notifyPrinter({
      printerId: payout.printerId.toString(),
      category: "system",
      priority: "medium",
      title: "Payout sent",
      message: `A payout of $${payout.amount.toFixed(2)} has been sent to your account.`,
      meta: { type: "payout_paid", payoutId: payout._id.toString(), amount: payout.amount },
      settingsKey: "payoutAlerts",
    }).catch(() => {});
  } catch (stripeErr: any) {
    payout.status = "failed";
    payout.failureReason = stripeErr?.message || "Stripe transfer failed";
    recordStatusChange(payout, "failed", req, payout.failureReason);
    await payout.save();
  }
};

export const adminRetryPayout = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { payoutId } = req.params;
    const payout = await Payout.findById(payoutId);
    if (!payout) {
      const e = new Error("Payout not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }
    if (payout.status !== "failed") {
      const e = new Error("Only failed payouts can be retried") as CustomError;
      e.statusCode = 400;
      throw e;
    }

    payout.retryCount += 1;
    await runPayoutTransfer(payout, req);
    res.json({ payout });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: Manual approval workflow ──────────────────────────────────────────

/**
 * The eligible (unpaid, shipped/completed) job breakdown for a printer, shown
 * before an admin creates/approves a payout. Uses the canonical earnings service
 * so amounts match everywhere and already-paid jobs never reappear.
 */
export const adminGetPrinterEligibleJobs = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { printerId } = req.params;
    const printer = await User.findById(printerId).select("name email companyName payoutsEnabled").lean();
    if (!printer) {
      const e = new Error("Printer not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }
    const { jobs, total, count } = await getEligibleJobsForPrinter(String(printerId));
    res.json({
      printer: {
        id: printer._id,
        name: (printer as any).companyName || printer.name,
        email: printer.email,
        payoutsEnabled: (printer as any).payoutsEnabled !== false,
      },
      jobs,
      total,
      count,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a payout request (status: pending_review) from a printer's currently
 * eligible jobs. Snapshots the job breakdown for auditing and reserves those
 * jobs so they cannot be included in another payout. Never initiates payment.
 */
export const adminCreatePayout = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { printerId } = req.body as { printerId?: string };
    if (!printerId) {
      const e = new Error("printerId is required") as CustomError;
      e.statusCode = 400;
      throw e;
    }

    const printer = await User.findById(printerId).select("name email companyName");
    if (!printer) {
      const e = new Error("Printer not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }

    const { jobs, total } = await getEligibleJobsForPrinter(String(printerId));
    if (jobs.length === 0 || total <= 0) {
      const e = new Error("This printer has no eligible jobs to pay out") as CustomError;
      e.statusCode = 400;
      throw e;
    }

    const payout = new Payout({
      printerId: new mongoose.Types.ObjectId(String(printerId)),
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
      createdByName: (req.user as any)?.name || (req.user as any)?.email || "Admin",
      metadata: { createdVia: "manual_admin_request" },
    });
    recordStatusChange(payout, "pending_review", req, `Created from ${jobs.length} eligible job(s)`);
    await payout.save();

    res.status(201).json({ payout });
  } catch (err) {
    next(err);
  }
};

/** Job breakdown for an existing payout — from its snapshot taken at creation. */
export const adminGetPayoutJobs = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { payoutId } = req.params;
    const payout = await Payout.findById(payoutId)
      .populate("printerId", "name email companyName")
      .lean();
    if (!payout) {
      const e = new Error("Payout not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }

    const jobs = (payout.lineItems || []).map((li: any) => ({
      orderId: String(li.orderId),
      jobId: String(li.orderId),
      displayId: li.displayId,
      orderNumber: li.orderNumber,
      customerName: li.customerName,
      jobStatus: li.jobStatus,
      completedAt: li.completedAt ? new Date(li.completedAt).toISOString() : null,
      amount: li.amount,
    }));

    res.json({
      payout: {
        id: payout._id,
        status: payout.status,
        amount: payout.amount,
        currency: payout.currency,
        printer: payout.printerId
          ? {
              id: (payout.printerId as any)._id,
              name: (payout.printerId as any).companyName || (payout.printerId as any).name,
              email: (payout.printerId as any).email,
            }
          : null,
        createdByName: payout.createdByName,
        approvedByName: payout.approvedByName,
        approvedAt: payout.approvedAt,
        rejectedByName: payout.rejectedByName,
        rejectedAt: payout.rejectedAt,
        rejectionReason: payout.rejectionReason,
        statusHistory: payout.statusHistory || [],
      },
      jobs,
      total: payout.amount,
      count: jobs.length,
    });
  } catch (err) {
    next(err);
  }
};

/** Approve a pending-review payout. Does NOT initiate payment. */
export const adminApprovePayout = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { payoutId } = req.params;
    const payout = await Payout.findById(payoutId);
    if (!payout) {
      const e = new Error("Payout not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }
    if (!["pending_review", "pending"].includes(payout.status)) {
      const e = new Error(`Only payouts pending review can be approved (current: ${payout.status})`) as CustomError;
      e.statusCode = 400;
      throw e;
    }

    payout.status = "approved";
    payout.approvedBy = req.user?.id ? new mongoose.Types.ObjectId(String(req.user.id)) : null;
    payout.approvedByName = (req.user as any)?.name || (req.user as any)?.email || "Admin";
    payout.approvedAt = new Date();
    recordStatusChange(payout, "approved", req, req.body?.note || null);
    await payout.save();

    res.json({ payout });
  } catch (err) {
    next(err);
  }
};

/** Reject a payout (before it is paid). Frees its jobs back into the eligible pool. */
export const adminRejectPayout = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { payoutId } = req.params;
    const { reason } = req.body as { reason?: string };
    const payout = await Payout.findById(payoutId);
    if (!payout) {
      const e = new Error("Payout not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }
    if (!["pending_review", "pending", "approved", "failed"].includes(payout.status)) {
      const e = new Error(`A ${payout.status} payout cannot be rejected`) as CustomError;
      e.statusCode = 400;
      throw e;
    }

    payout.status = "rejected";
    payout.rejectedBy = req.user?.id ? new mongoose.Types.ObjectId(String(req.user.id)) : null;
    payout.rejectedByName = (req.user as any)?.name || (req.user as any)?.email || "Admin";
    payout.rejectedAt = new Date();
    payout.rejectionReason = reason || null;
    recordStatusChange(payout, "rejected", req, reason || null);
    await payout.save();

    res.json({ payout });
  } catch (err) {
    next(err);
  }
};

/**
 * Initiate payment for an APPROVED payout. This is the explicit, manual step
 * that actually moves money — only reachable after approval.
 */
export const adminProcessPayout = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { payoutId } = req.params;
    const payout = await Payout.findById(payoutId);
    if (!payout) {
      const e = new Error("Payout not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }
    if (payout.status !== "approved") {
      const e = new Error(`Only approved payouts can be processed (current: ${payout.status})`) as CustomError;
      e.statusCode = 400;
      throw e;
    }

    await runPayoutTransfer(payout, req);
    res.json({ payout });
  } catch (err) {
    next(err);
  }
};

export const adminTogglePrinterPayouts = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { printerId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      const e = new Error("'enabled' must be a boolean") as CustomError;
      e.statusCode = 400;
      throw e;
    }

    const printer = await User.findByIdAndUpdate(
      printerId,
      { payoutsEnabled: enabled },
      { new: true }
    ).select("name email payoutsEnabled");

    if (!printer) {
      const e = new Error("Printer not found") as CustomError;
      e.statusCode = 404;
      throw e;
    }

    res.json({ printerId, payoutsEnabled: printer.payoutsEnabled, name: printer.name });
  } catch (err) {
    next(err);
  }
};

export const adminListPrinterPayoutStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const printers = await User.find({ role: "PRINTER" })
      .select("name email companyName stripeConnectAccountId stripeConnectOnboarded payoutsEnabled createdAt")
      .lean();

    const printerIds = printers.map((p) => p._id);

    const payoutAgg = await Payout.aggregate([
      { $match: { printerId: { $in: printerIds } } },
      {
        $group: {
          _id: "$printerId",
          lastStatus: { $last: "$status" },
          lastPayout: { $last: "$processedAt" },
          totalPaid: {
            $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] },
          },
          pendingCount: {
            $sum: {
              $cond: [
                { $in: ["$status", ["pending_review", "pending", "approved", "processing"]] },
                1,
                0,
              ],
            },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
        },
      },
    ]);

    const agg = Object.fromEntries(payoutAgg.map((a) => [a._id.toString(), a]));

    // Compute each printer's currently-eligible (unpaid) balance & job count so the
    // admin can see who has jobs ready for a payout without opening each one.
    const eligibleByPrinter = await Promise.all(
      printers.map(async (p) => {
        const { total, count } = await getEligibleJobsForPrinter(p._id.toString());
        return [p._id.toString(), { total, count }] as const;
      }),
    );
    const eligibleMap = Object.fromEntries(eligibleByPrinter);

    const result = printers.map((p) => {
      const stats = agg[p._id.toString()] || {};
      const eligible = eligibleMap[p._id.toString()] || { total: 0, count: 0 };
      return {
        printerId: p._id,
        name: p.name,
        email: p.email,
        companyName: p.companyName,
        stripeConnected: !!p.stripeConnectAccountId,
        stripeOnboarded: !!p.stripeConnectOnboarded,
        payoutsEnabled: p.payoutsEnabled !== false,
        lastPayoutStatus: stats.lastStatus || null,
        lastPayoutDate: stats.lastPayout || null,
        totalPaid: stats.totalPaid || 0,
        pendingPayouts: stats.pendingCount || 0,
        failedPayouts: stats.failedCount || 0,
        eligibleAmount: eligible.total,
        eligibleJobs: eligible.count,
      };
    });

    res.json({ printers: result });
  } catch (err) {
    next(err);
  }
};

export const adminExportPayouts = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { status, printerId: printerFilter } = req.query;
    const filter: any = {};
    if (status && status !== "all") filter.status = status;
    if (printerFilter) filter.printerId = printerFilter;

    const payouts = await Payout.find(filter)
      .populate("printerId", "name email companyName")
      .sort({ createdAt: -1 })
      .lean();

    const rows = [
      ["Payout ID", "Printer Name", "Printer Email", "Amount", "Currency", "Status", "Scheduled Date", "Processed At", "Stripe Transfer ID", "Retry Count", "Failure Reason"].join(","),
      ...payouts.map((p: any) => {
        const printer = p.printerId || {};
        return [
          p._id.toString(),
          `"${(printer.name || "").replace(/"/g, "'")}"`,
          printer.email || "",
          p.amount.toFixed(2),
          p.currency.toUpperCase(),
          p.status,
          new Date(p.scheduledDate).toISOString(),
          p.processedAt ? new Date(p.processedAt).toISOString() : "",
          p.stripeTransferId || "",
          p.retryCount,
          `"${(p.failureReason || "").replace(/"/g, "'")}"`,
        ].join(",");
      }),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="admin-payouts-${Date.now()}.csv"`
    );
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// ─── WEBHOOK: Stripe events ───────────────────────────────────────────────────

export const handleStripeWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = env.stripeWebhookSecret;

  if (!webhookSecret) {
    return res.status(400).json({ error: "Webhook secret not configured" });
  }

  let event;
  try {
    const { constructWebhookEvent } = await import("../services/stripe.service.js");
    event = constructWebhookEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "payout.paid": {
        const stripePayout = event.data.object as any;
        const payoutId = stripePayout.metadata?.payoutId;
        if (payoutId) {
          await Payout.findByIdAndUpdate(payoutId, {
            status: "paid",
            processedAt: new Date(stripePayout.arrival_date * 1000),
            stripePayoutId: stripePayout.id,
          });
          console.log(`[Stripe Webhook] Payout ${payoutId} marked paid`);
        }
        break;
      }
      case "payout.failed": {
        const stripePayout = event.data.object as any;
        const payoutId = stripePayout.metadata?.payoutId;
        if (payoutId) {
          await Payout.findByIdAndUpdate(payoutId, {
            status: "failed",
            failureReason: stripePayout.failure_message || "Stripe payout failed",
          });
          console.log(`[Stripe Webhook] Payout ${payoutId} failed`);
        }
        break;
      }
      case "transfer.created": {
        console.log(`[Stripe Webhook] Transfer created: ${(event.data.object as any).id}`);
        break;
      }
      case "account.updated": {
        const account = event.data.object as any;
        const onboarded = account.details_submitted && account.charges_enabled && account.payouts_enabled;
        if (onboarded) {
          await User.updateOne(
            { stripeConnectAccountId: account.id },
            { stripeConnectOnboarded: true }
          );
        }
        break;
      }
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
};
