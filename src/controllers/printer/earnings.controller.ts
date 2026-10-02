import { Request, Response, NextFunction } from "express";
import { printerStatusLabel } from "../../utils/orderStatusLabels.js";
import { getPartnerPayRate } from "../../services/pricing.service.js";
import { Order } from "../../models/order.model.js";
import { Payout } from "../../models/payout.model.js";
import mongoose from "mongoose";
import { calculateOrderPartnerEarning, getOrderCompletionDate } from "../../services/partnerEarnings.service.js";

/**
 * The rows behind the earnings table, shared with the CSV export so the file a
 * partner downloads is the table they are looking at.
 *
 * The Export button sat above this table, named its file `earnings-export.csv`,
 * and called the PAYOUT-history endpoint — which returns a row per Stripe
 * payout. With no payouts in existence it downloaded a header and nothing else.
 */
const buildEarningsRows = async (
  printerId: string,
  range: unknown,
  status: unknown,
) => {

    const partnerPricing = await getPartnerPayRate();

    const payouts = await Payout.find({
      printerId: new mongoose.Types.ObjectId(String(printerId)),
    })
      .select("orderIds status")
      .lean();

    const paidOrderIds = new Set<string>();
    const scheduledOrderIds = new Set<string>();
    for (const p of payouts as any[]) {
      const ids = (p.orderIds || []).map((id: any) => String(id));
      if (p.status === "paid") ids.forEach((id: string) => paidOrderIds.add(id));
      else if (["pending_review", "approved", "processing"].includes(String(p.status))) {
        ids.forEach((id: string) => scheduledOrderIds.add(id));
      }
    }

  const query: any = { assignedPrinter: printerId, status: { $nin: ["CANCELLED"] } };

    const orders = await Order.find(query)
      .select("displayId items pricing priority status statusTimeline updatedAt createdAt customer")
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();

    const FINISHED = ["SHIPPED", "COMPLETED"];

    const rows = orders.map((order: any) => {
      const id = String(order._id);
      const isFinished = FINISHED.includes(String(order.status));

      /*
       * Four states that line up with the four summary cards above the table,
       * so the rows add up to the totals instead of describing something else:
       *   Pending   — not shipped yet, so not earned yet
       *   Available — shipped, not yet in a payout (this is Available Balance)
       *   Scheduled — in a payout that is being reviewed or processed
       *   Paid      — in a payout that actually paid out
       */
      let payoutStatus: "Paid" | "Scheduled" | "Available" | "Pending";
      if (paidOrderIds.has(id)) payoutStatus = "Paid";
      else if (scheduledOrderIds.has(id)) payoutStatus = "Scheduled";
      else if (isFinished) payoutStatus = "Available";
      else payoutStatus = "Pending";

      // The real completion moment from the timeline, not `updatedAt` — which
      // any later edit bumps, and which is not a completion date at all for a
      // job that has not shipped.
      const completedAt = isFinished ? getOrderCompletionDate(order) : null;

      const items: any[] = Array.isArray(order.items) ? order.items : [];
      const firstName = items[0]?.name || items[0]?.type || "Print Job";

      return {
        // Both: the real id so a row can link to the job, and the human number.
        id,
        displayId: order.displayId ? String(order.displayId) : null,
        customer:
          `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "—",
        details: {
          title: items.length > 1 ? `${firstName} +${items.length - 1} more` : firstName,
          sub: `${items.reduce((s: number, i: any) => s + (i.quantity || 1), 0)} item(s)`,
        },
        // The partner's rate, the same figure Home and the payout summary use.
        earning: calculateOrderPartnerEarning(order, partnerPricing),
        completedAt: completedAt ? completedAt.toISOString() : null,
        status: payoutStatus,
        orderStatus: printerStatusLabel(String(order.status || "")),
      };
    });

    /*
     * Ranges filter on when a job was COMPLETED, not on `updatedAt`. "Today"
     * meant "touched today" before, so editing a note on an old job pulled it
     * into today's earnings. Unfinished jobs have no completion date and so sit
     * outside every dated range, which is correct — they have earned nothing yet.
     */
    const now = Date.now();
    const windowMs = range === "7d" ? 7 * 864e5 : range === "30d" ? 30 * 864e5 : null;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let filtered = rows;
    if (range === "today") {
      filtered = rows.filter((r) => r.completedAt && new Date(r.completedAt) >= todayStart);
    } else if (range === "ytd") {
      // Calendar year to date — the same window the dashboard's YTD uses, so
      // the two pages answer the same question the same way. Not a rolling
      // 365 days, which would disagree with it every day but 1 January.
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      filtered = rows.filter((r) => r.completedAt && new Date(r.completedAt) >= yearStart);
    } else if (windowMs) {
      filtered = rows.filter((r) => r.completedAt && now - new Date(r.completedAt).getTime() <= windowMs);
    }

    if (status === "Paid") filtered = filtered.filter((r) => r.status === "Paid");
    else if (status === "Pending") filtered = filtered.filter((r) => r.status === "Pending");
    else if (status === "Available") filtered = filtered.filter((r) => r.status === "Available");
    else if (status === "Scheduled") filtered = filtered.filter((r) => r.status === "Scheduled");

  return {
    jobs: filtered,
    // So the table's own total can be shown without the client re-deriving it
    // from formatted strings.
    total: Math.round(filtered.reduce((s, r) => s + r.earning, 0) * 100) / 100,
    count: filtered.length,
  };
};

export const listEarningsJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await buildEarningsRows(String(req.user?.id), req.query.range ?? "all", req.query.status));
  } catch (error) {
    next(error);
  }
};

/** The same rows, as a CSV. */
export const exportEarningsCsv = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobs, total } = await buildEarningsRows(
      String(req.user?.id),
      req.query.range ?? "all",
      req.query.status,
    );

    // Quoted and internally-escaped: customer names carry commas and quotes,
    // and an unescaped one shifts every later column on that row.
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Order", "Customer", "Job", "Items", "Completed", "Job status", "Payout status", "Your earning"]
        .map(cell)
        .join(","),
      ...jobs.map((j: any) =>
        [
          j.displayId || j.id,
          j.customer,
          j.details.title,
          j.details.sub,
          j.completedAt ? new Date(j.completedAt).toISOString().split("T")[0] : "",
          j.orderStatus,
          j.status,
          j.earning.toFixed(2),
        ].map(cell).join(","),
      ),
      ["", "", "", "", "", "", "Total", total.toFixed(2)].map(cell).join(","),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="earnings-${new Date().toISOString().split("T")[0]}.csv"`,
    );
    res.send(csv);
  } catch (error) {
    next(error);
  }
};
