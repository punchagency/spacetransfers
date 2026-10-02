import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";
import { getPartnerPayRate } from "./pricing.service.js";

/**
 * Single source of truth for partner earnings & payout eligibility.
 *
 * Every place that needs "how much does this partner earn for this job" or
 * "which jobs are eligible for payout" MUST go through here so the printer
 * dashboard, admin earnings, payout drafts, and the approval workflow all agree.
 */

// Only shipped/completed jobs are eligible to be paid out.
export const PAYOUT_ELIGIBLE_ORDER_STATUSES = ["SHIPPED", "COMPLETED"] as const;

// Payout statuses that "reserve" their jobs — i.e. those jobs may NOT be
// included in another payout. Only rejected/cancelled payouts release their
// jobs back into the eligible pool. This is what prevents double-paying a job.
export const RESERVING_PAYOUT_STATUSES = [
  "pending_review",
  "approved",
  "processing",
  "paid",
  "failed",
] as const;

const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Whether a partner cost can be derived for this order at all.
 *
 * Cost comes from sheet area, so an order whose items carry no usable
 * dimensions has an *unknown* cost, not a zero one. The distinction matters
 * because the two look identical once the number reaches a template: the admin
 * dashboard rendered `profit = total - 0` and so reported 100% margin on orders
 * it simply had no cost data for.
 *
 * The previous code hid this by charging a flat $5.00 for dimensionless items,
 * which was not a real cost either — just a less obvious invention.
 */
/**
 * Whether an order's margin is money that has actually been earned, or a
 * forecast.
 *
 * Partners are only paid once a job ships, so before that the cost side is a
 * projection — and the dashboard counts revenue from the moment an order is
 * placed, so the revenue side is one too. Derived from the same status list
 * that gates real payouts, rather than a second copy that could drift.
 */
export const isPartnerEarningRealized = (order: any): boolean =>
  (PAYOUT_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(String(order?.status || "")) ||
  isCancelledButPaid(order);

/** An order the admin cancelled after work began, choosing to pay the partner anyway. */
export const isCancelledButPaid = (order: any): boolean =>
  String(order?.status || "") === "CANCELLED" && order?.cancellation?.partnerPaid === true;

/**
 * The orders a partner is paid for: shipped or delivered, plus any cancelled
 * job the admin chose to pay. Every earnings and payout query uses this, so
 * the screens cannot disagree about what is owed.
 */
export const payableOrderFilter = () => ({
  $or: [
    { status: { $in: [...PAYOUT_ELIGIBLE_ORDER_STATUSES] } },
    { status: "CANCELLED", "cancellation.partnerPaid": true },
  ],
});

export const canDerivePartnerEarning = (order: any): boolean => {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return false;

  // Mirrors the field precedence in `computePartnerCostBreakdown`.
  return items.some((it: any) => {
    const w = typeof it?.sheetWidthIn === "number" ? it.sheetWidthIn : it?.widthIn;
    const h = typeof it?.sheetHeightIn === "number" ? it.sheetHeightIn : it?.heightIn;
    return (
      typeof w === "number" && typeof h === "number" &&
      Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    );
  });
};

/**
 * The amount a partner earns for a single order, based on THAT partner's pricing
 * (base rate / tiers / surcharges) via the shared cost breakdown. Falls back to
 * an empty pricing object (which the breakdown handles with sane defaults).
 */
/**
 * The full cost breakdown, not just the total.
 *
 * Marking an order URGENT adds the partner's `rushPct` to what they are owed —
 * 10% on every seeded partner — and that was folded silently into
 * `partnerPayout`. An admin could raise a payout by a tenth and see only the
 * new total, with nothing saying why.
 */
export const getOrderPartnerCostBreakdown = (order: any, partnerPricing: any) =>
  computePartnerCostBreakdown({
    items: Array.isArray(order?.items) ? order.items : [],
    partnerPricing: partnerPricing || {},
    priority: order?.priority,
    adjustments: order?.pricing?.adjustments || [],
  });

export const calculateOrderPartnerEarning = (
  order: any,
  partnerPricing: any,
): number => getOrderPartnerCostBreakdown(order, partnerPricing).subtotal;

/** Best-effort completion date: the timeline entry for SHIPPED/COMPLETED, else updatedAt. */
export const getOrderCompletionDate = (order: any): Date | null => {
  const timeline = Array.isArray(order?.statusTimeline) ? order.statusTimeline : [];
  const done = [...timeline]
    .reverse()
    .find((e: any) => e?.status === "COMPLETED" || e?.status === "SHIPPED");
  if (done?.time) return new Date(done.time);
  if (isCancelledButPaid(order) && order.cancellation?.at) return new Date(order.cancellation.at);
  return order?.updatedAt ? new Date(order.updatedAt) : null;
};

/**
 * IDs of a printer's orders that are already locked into a non-rejected,
 * non-cancelled payout — these must be excluded from any new payout.
 */
export const getReservedOrderIds = async (printerId: string): Promise<Set<string>> => {
  const payouts = await Payout.find({
    printerId: new mongoose.Types.ObjectId(String(printerId)),
    status: { $in: RESERVING_PAYOUT_STATUSES as any },
  })
    .select("orderIds")
    .lean();
  return new Set(payouts.flatMap((p: any) => (p.orderIds || []).map((id: any) => String(id))));
};

export interface EligibleJob {
  orderId: string;
  jobId: string;
  displayId: string;
  orderNumber: string;
  customerName: string;
  jobStatus: string;
  completedAt: string | null;
  amount: number;
}

export interface EligibleJobsResult {
  jobs: EligibleJob[];
  total: number;
  count: number;
}

/**
 * The list of a printer's payout-eligible jobs (shipped/completed and not yet
 * reserved by another payout), each with the partner's per-job earning, plus the
 * total. This powers both the pre-approval job breakdown and payout creation.
 */
export const getEligibleJobsForPrinter = async (
  printerId: string,
): Promise<EligibleJobsResult> => {
  // One network-wide rate, not the partner's own — see `getPartnerPayRate`.
  const partnerPricing = await getPartnerPayRate();

  const reserved = await getReservedOrderIds(printerId);

  const orders = await Order.find({
    assignedPrinter: new mongoose.Types.ObjectId(String(printerId)),
    ...payableOrderFilter(),
  })
    .select("displayId items pricing priority status statusTimeline customer updatedAt createdAt cancellation")
    .sort({ updatedAt: -1 })
    .lean();

  const jobs: EligibleJob[] = [];
  for (const order of orders) {
    const id = String((order as any)._id);
    if (reserved.has(id)) continue; // already in a payout — never double-pay
    const amount = calculateOrderPartnerEarning(order, partnerPricing);
    if (amount <= 0) continue; // nothing to pay for this job
    const displayId = (order as any).displayId || id.slice(-6).toUpperCase();
    const completedAt = getOrderCompletionDate(order);
    jobs.push({
      orderId: id,
      jobId: id,
      displayId,
      orderNumber: `#${displayId}`,
      customerName: `${(order as any).customer?.firstName || ""} ${(order as any).customer?.lastName || ""}`.trim() || "—",
      jobStatus: String((order as any).status || ""),
      completedAt: completedAt ? completedAt.toISOString() : null,
      amount: roundMoney(amount),
    });
  }

  const total = roundMoney(jobs.reduce((s, j) => s + j.amount, 0));
  return { jobs, total, count: jobs.length };
};
