import { Request, Response, NextFunction } from "express";
import { orderSheets } from "../../utils/orderSheets.js";
import { stageDue } from "../../utils/slaStages.js";
import { printerStatusLabel } from "../../utils/orderStatusLabels.js";
import { getPartnerPayRate } from "../../services/pricing.service.js";
import { Order } from "../../models/order.model.js";
import mongoose from "mongoose";
import { calculateOrderPartnerEarning, getOrderCompletionDate } from "../../services/partnerEarnings.service.js";
import { getAssignmentSettings, ACTIVE_ORDER_STATUSES } from "../../services/partnerCapacity.service.js";

/** "Accept by" / "Print by" for a job, from the same clock the SLA enforces. */
const dueFields = (job: any, sla: any) => {
  const due = stageDue(job, sla);
  return { deadline: due ? due.dueAt.toISOString() : null, dueStage: due ? due.stage : null };
};

/** "1 sheet" / "2 sheets" — these rows said "2 Items" for two gang sheets. */
const sheetCountLabel = (items: unknown) => {
  const n = orderSheets(items).length;
  return `${n} ${n === 1 ? "sheet" : "sheets"}`;
};

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slaSettings = (await getAssignmentSettings()).sla;
    const printerId = req.user?.id;

    /*
     * The same four periods the admin dashboard offers, so the two consoles
     * report over comparable windows. Two of the four cards are current-state
     * (what is waiting on you, what you have earned in total) and deliberately
     * do NOT follow the period — each says so in its own note, which is what
     * stops the control being ambiguous.
     */
    const RANGES: Record<string, number | "ytd"> = { "7d": 7, "30d": 30, "90d": 90, ytd: "ytd" };
    const rangeKey = typeof req.query.range === "string" && req.query.range in RANGES
      ? String(req.query.range)
      : "30d";

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    let periodStart: Date;
    if (rangeKey === "ytd") {
      periodStart = new Date(now.getFullYear(), 0, 1);
    } else {
      periodStart = new Date(todayStart);
      periodStart.setDate(periodStart.getDate() - (Number(RANGES[rangeKey]) - 1));
    }
    const periodLabel =
      rangeKey === "ytd" ? "year to date" : `the last ${RANGES[rangeKey]} days`;

    // One resolution of the network-wide partner rate for the whole request.
    const partnerRate = await getPartnerPayRate();
    const sumEarnings = (orders: any[]) =>
      Math.round(orders.reduce((s, o) => s + calculateOrderPartnerEarning(o, partnerRate), 0) * 100) / 100;

    /*
     * "Completed today" is keyed on when the order actually reached SHIPPED,
     * read from `statusTimeline` — not on `updatedAt`, which this used before.
     * Any edit to an old order bumps `updatedAt`, so a month-old job being
     * touched made it count as completed today and inflated both the count and
     * the day's earnings. `partnerPerformance` already reads the timeline for
     * exactly this reason.
     */
    const finishedOrders = await Order.find({
      assignedPrinter: printerId,
      status: { $in: ["SHIPPED", "COMPLETED"] },
    })
      .select("items pricing priority statusTimeline updatedAt")
      .lean();

    const finishedInPeriod = finishedOrders.filter((o) => {
      const at = getOrderCompletionDate(o);
      return at !== null && at >= periodStart;
    });

    const periodEarnings = sumEarnings(finishedInPeriod);

    /*
     * Every order still owed or already paid, at the partner's rate. Named
     * "Total Earned", not "Total Revenue": revenue is what the company takes,
     * and this is a partner's own page.
     */
    const allActiveOrders = await Order.find({
      assignedPrinter: printerId,
      status: { $nin: ["CANCELLED"] },
    })
      .select("items pricing priority")
      .lean();
    const totalEarned = sumEarnings(allActiveOrders);

    // Counted, not derived from the capped list below.
    const [totalPendingCount, assignedTotal, urgentTotal] = await Promise.all([
      Order.countDocuments({ assignedPrinter: printerId, status: "PENDING" }),
      Order.countDocuments({ assignedPrinter: printerId, status: { $in: ACTIVE_ORDER_STATUSES as any } }),
      Order.countDocuments({
        assignedPrinter: printerId,
        priority: "URGENT",
        status: { $in: ["PENDING", "PROCESSING"] },
      }),
    ]);

    const ASSIGNED_LIMIT = 12;
    const URGENT_LIMIT = 5;

    // The shared constant, not a second hand-written copy — the sidebar capacity
    // meter counts the same set and they must not drift apart.
    /*
     * Urgent first, then newest.
     *
     * Sorted by `createdAt` alone, an urgent job that had been waiting longest
     * sorted last and fell off the end of the capped list — so the banner could
     * say "you have 3 urgent jobs" above a table showing none of them. Mongo has
     * no ordering on an arbitrary string, so priority is projected to a number
     * to sort on.
     */
    const activeAssignedJobs = await Order.aggregate([
      { $match: { assignedPrinter: new mongoose.Types.ObjectId(String(printerId)), status: { $in: ACTIVE_ORDER_STATUSES as any } } },
      { $addFields: { _urgentFirst: { $cond: [{ $eq: ["$priority", "URGENT"] }, 0, 1] } } },
      { $sort: { _urgentFirst: 1, createdAt: -1, _id: -1 } },
      { $limit: ASSIGNED_LIMIT },
    ]);

    // One shared map — see `utils/orderStatusLabels`.
    const mapStatus = printerStatusLabel;

    const assignedJobs = activeAssignedJobs.map((job: any) => ({
      id: String(job._id),
      displayId: job?.displayId ? String(job.displayId) : null,
      customerName: `${job.customer?.firstName || ""} ${job.customer?.lastName || ""}`.trim(),
      order: sheetCountLabel(job.items),
      // What is due next (accept by / print by) — the clock the SLA enforces.
      ...dueFields(job, slaSettings),
      assignedAt: job.assignedAt ? new Date(job.assignedAt).toISOString() : null,
      status: mapStatus(String(job.status || "")),
      isUrgent: String(job.priority || "").toUpperCase() === "URGENT",
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    }));

    const urgentJobs = await Order.find({
      assignedPrinter: printerId,
      priority: "URGENT",
      status: { $in: ["PENDING", "PROCESSING"] },
    })
      .select("displayId customer items createdAt assignedAt assignmentDeadline priority status")
      .sort({ createdAt: 1 })
      .limit(URGENT_LIMIT)
      .lean();

    const formattedUrgentJobs = urgentJobs.map((job: any) => ({
      id: String(job._id),
      displayId: job?.displayId ? String(job.displayId) : null,
      customerName: `${job.customer?.firstName || ""} ${job.customer?.lastName || ""}`.trim(),
      order: sheetCountLabel(job.items),
      ...dueFields(job, slaSettings),
      assignedAt: job.assignedAt ? new Date(job.assignedAt).toISOString() : null,
      status: "Urgent",
      isUrgent: true,
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    }));

    const fmtMoney = (n: number) =>
      `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    /*
     * No trends. All four were "vs yesterday" and none of them measured that:
     * the revenue one compared a lifetime total against itself before today (so
     * it could only ever rise), the pending one was a raw count with a baseline
     * of "orders created before today", and a zero baseline returned "0%" — which
     * the page rendered in green as "no change" when it meant "nothing to
     * compare". `trendUp` was computed here and ignored by the client entirely.
     *
     * Each card carries a `note` instead: a plain statement of what the number
     * covers, which is what the trend line was pretending to be.
     */
    res.json({
      cards: [
        {
          label: "Earnings",
          value: fmtMoney(periodEarnings),
          note: finishedInPeriod.length
            ? `From ${finishedInPeriod.length} job${finishedInPeriod.length === 1 ? "" : "s"} shipped in ${periodLabel}`
            : `No jobs shipped in ${periodLabel}`,
          scoped: true,
        },
        {
          label: "Jobs Completed",
          value: finishedInPeriod.length.toLocaleString(),
          note: `Shipped in ${periodLabel}`,
          scoped: true,
        },
        {
          // Current state, not a period figure — it is what is waiting on them
          // right now, and saying "in the last 30 days" would be nonsense.
          label: "Pending Orders",
          value: totalPendingCount.toLocaleString(),
          note: totalPendingCount ? "Awaiting your acceptance now" : "Nothing waiting on you",
          scoped: false,
        },
        {
          label: "Total Earned",
          value: fmtMoney(totalEarned),
          note: `All time, across ${allActiveOrders.length} job${allActiveOrders.length === 1 ? "" : "s"}`,
          scoped: false,
        },
      ],
      urgentJobs: formattedUrgentJobs,
      assignedJobs,
      assignedTotal,
      urgentTotal,
      assignedShown: assignedJobs.length,
      urgentShown: formattedUrgentJobs.length,
      period: { range: rangeKey, label: periodLabel },
    });
  } catch (error) {
    next(error);
  }
};
