import { Request, Response, NextFunction } from "express";
import { computeOrderFinancials, isOrderProfitSettled } from "../../services/orderFinancials.service.js";
import { resolveOrderRegion } from "../../utils/region.js";
import { Order } from "../../models/order.model.js";
import { User, UserRoles, IUser } from "../../models/user.model.js";
import { getPartnerPayRate } from "../../services/pricing.service.js";

export const getAdminDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { range = "30d" } = req.query;

    let startDate: Date;
    let priorStartDate: Date;
    let priorEndDate: Date;
    const now = new Date();

    if (range === "7d") {
      startDate = new Date(new Date().setDate(now.getDate() - 7));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 14));
      priorEndDate = startDate;
    } else if (range === "90d") {
      startDate = new Date(new Date().setDate(now.getDate() - 90));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 180));  
      priorEndDate = startDate;
    } else if (range === "ytd") {
      startDate = new Date(new Date().getFullYear(), 0, 1);
      priorStartDate = new Date(new Date().getFullYear() - 1, 0, 1);
      priorEndDate = new Date(new Date().getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      startDate = new Date(new Date().setDate(now.getDate() - 30));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 60));
      priorEndDate = startDate;
    }

    const orderStats = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } }
        }
      }
    ]);

    const orders = orderStats[0] || { total: 0, pending: 0, completed: 0, cancelled: 0 };

    const revenueStats = await Order.aggregate([
      {
        $facet: {
          current: [
            { $match: { createdAt: { $gte: startDate }, status: { $nin: ["CANCELLED", "REJECTED"] } } },
            { $group: { _id: null, total: { $sum: "$pricing.total" }, count: { $sum: 1 } } }
          ],
          prior: [
            { $match: { createdAt: { $gte: priorStartDate, $lt: priorEndDate }, status: { $nin: ["CANCELLED", "REJECTED"] } } },
            { $group: { _id: null, total: { $sum: "$pricing.total" } } }
          ]
        }
      }
    ]);

    const currentRevenue = revenueStats[0].current[0]?.total || 0;
    const priorRevenue = revenueStats[0].prior[0]?.total || 0;

    /**
     * `trendPct` alone could not express "nothing to compare against".
     *
     * With no revenue in the prior window it reported +100%, which reads as
     * growth rather than "this is the first period with any revenue"; and a
     * genuine flat period (prior > 0, identical totals) also produced 0, which
     * the client could not tell apart from two empty periods. `priorAmount` is
     * returned so the caller can distinguish the cases.
     */
    const comparable = priorRevenue > 0;
    const trendPct = comparable
      ? ((currentRevenue - priorRevenue) / priorRevenue) * 100
      : 0;

    const partnerStats = await User.aggregate([
      { $match: { role: UserRoles.PRINTER } },
      {
        $group: {
          _id: null,
          active: { $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ["$status", "Suspended"] }, 1, 0] } }
        }
      }
    ]);

    const partners = partnerStats[0] || { active: 0, suspended: 0 };

    const recentOrdersRaw = await Order.find()
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions settings.pricing defaultShippingAddress businessAddress");

    const recentUserIds = Array.from(
      new Set(
        recentOrdersRaw
          .map((o: any) => (o.user ? String(o.user) : null))
          .filter(Boolean)
      )
    ) as string[];
    const recentUsers = recentUserIds.length > 0
      ? await User.find({ _id: { $in: recentUserIds } }).select("regions").lean()
      : [];
    const recentUserRegionMap = new Map<string, string | null>(
      recentUsers.map((u: any) => [String(u._id), Array.isArray(u.regions) ? (u.regions[0] || null) : null])
    );

    // One rate for the whole network, read once for this response rather than
    // per order.
    const partnerPayRate = await getPartnerPayRate();

    // Profit after tax, shipping, partner cost and card fees — the one
    // definition in `orderFinancials.service`. Null when no partner cost can be
    // derived (an order with no sheet dimensions), never an invented zero.
    const calculateOrderFinancials = (order: any) => {
      const f = computeOrderFinancials(order, partnerPayRate);
      return { customerCharge: f.customerPaid, partnerPayout: f.partnerCost, profit: f.profit };
    };
 
    const recentOrders = recentOrdersRaw.map(order => {
      const { profit } = calculateOrderFinancials(order);
      return {
        id: order._id,
        // Same canonical order number the Orders table shows. Without it this
        // table fell back to a slice of the ObjectId, so Home and Orders
        // displayed different numbers for the same order.
        displayId: (order as any).displayId || null,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        // null travels to the client, which renders it as "—". Sending 0 here
        // would be indistinguishable from a genuinely costless order.
        profits: profit === null ? null : Number(profit.toFixed(2)),
        // False until the job ships: partners are not paid before then, and
        // revenue is counted from placement, so both sides are still a forecast.
        profitsRealized: isOrderProfitSettled(order),
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: (order as any).updatedAt ? new Date((order as any).updatedAt).toISOString() : null,
        returnedAt: (order as any).returnedAt ? new Date((order as any).returnedAt).toISOString() : null,
        cancelledByPrinterName: (order as any).cancelledByPrinterName || null,
        isReturnedToQueue: !!(order as any).returnedAt,
        assignedPartner: (order.assignedPrinter as unknown as IUser)?.companyName || null,
        region: resolveOrderRegion(order, recentUserRegionMap)
      };
    });

    res.json({
      stats: {
        totalOrders: orders.total,
        pendingOrders: orders.pending,
        activePartners: partners.active,
        totalRevenue: {
          amount: Number(currentRevenue.toFixed(2)),
          trendPct: Number(trendPct.toFixed(1)),
          priorAmount: Number(priorRevenue.toFixed(2)),
          comparable
        }
      },
      recentOrders
    });
  } catch (error) {
    next(error);
  } 
};

export const getEarningsSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rangeKey = String(req.query.range || "30d");
    const now = new Date();

    const RANGES: Record<
      string,
      { label: string; priorLabel: string; buckets: number; days?: number }
    > = {
      "7d": { label: "Last 7 days", priorLabel: "Previous 7 days", buckets: 7, days: 7 },
      "30d": { label: "Last 30 days", priorLabel: "Previous 30 days", buckets: 15, days: 30 },
      "90d": { label: "Last 90 days", priorLabel: "Previous 90 days", buckets: 13, days: 90 },
      ytd: { label: "Year to date", priorLabel: "Same period last year", buckets: now.getMonth() + 1 }
    };
    const range = RANGES[rangeKey] || RANGES["30d"];

    let startDate: Date;
    let priorStartDate: Date;
    let priorEndDate: Date;

    if (rangeKey === "ytd") {
      startDate = new Date(now.getFullYear(), 0, 1);
      priorStartDate = new Date(now.getFullYear() - 1, 0, 1);
      priorEndDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      const days = range.days as number;
      startDate = new Date(new Date().setDate(now.getDate() - days));
      priorStartDate = new Date(new Date().setDate(now.getDate() - days * 2));
      priorEndDate = startDate;
    }

    /*
     * CANCELLED is the only excluded status. "REJECTED" was also listed here but
     * no order has ever held it — the enum is PENDING/PROCESSING/PRINTING/
     * QUALITY_CHECK/SHIPPED/COMPLETED/CANCELLED — so it filtered on a state that
     * does not exist.
     */
    const EXCLUDED_STATUSES = ["CANCELLED"];
    const populateFields =
      "companyName regions settings.pricing defaultShippingAddress businessAddress";

    const orders = await Order.find({
      createdAt: { $gte: startDate },
      status: { $nin: EXCLUDED_STATUSES }
    }).populate<{ assignedPrinter: IUser }>("assignedPrinter", populateFields);

    const priorOrders = await Order.find({
      createdAt: { $gte: priorStartDate, $lt: priorEndDate },
      status: { $nin: EXCLUDED_STATUSES }
    }).populate<{ assignedPrinter: IUser }>("assignedPrinter", populateFields);

    // Region attribution falls back to the customer's profile when an order has
    // no usable shipping address — the same map the orders table builds.
    const userIds = Array.from(
      new Set(orders.map((o: any) => (o.user ? String(o.user) : null)).filter(Boolean) as string[])
    );
    const userDocs = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select("_id regions").lean()
      : [];
    const userRegionMap = new Map<string, string | null>(
      userDocs.map((u: any) => [String(u._id), Array.isArray(u.regions) ? u.regions[0] || null : null])
    );

    // One rate, from global pricing — the same breakdown the order-financials
    // view and the payout system use, so no two screens disagree on cost.
    const payRate = await getPartnerPayRate();

    const totalsFor = (list: any[]) => {
      let revenue = 0;
      let cost = 0;
      let tax = 0;
      let shipping = 0;
      let cardFees = 0;
      let refunds = 0;
      let feesMissing = 0;
      let margin = 0;
      let earned = 0;
      let earnedOrders = 0;
      let uncostable = 0;

      for (const o of list) {
        // Everything the customer paid — printing, rush, shipping and tax: the
        // money into the company account, which is what an admin reconciles.
        revenue += o.pricing?.total || 0;

        const f = computeOrderFinancials(o, payRate);
        if (f.profit === null || f.partnerCost === null) {
          uncostable += 1;
          continue;
        }
        cost += f.partnerCost;
        tax += f.tax;
        shipping += f.shippingCost;
        cardFees += f.processingFee ?? 0;
        refunds += f.refunded;
        // Only real Stripe payments have a fee to be missing; pre-Stripe
        // placeholder payments ("mock_txn_…") never did.
        if (f.processingFee === null && /^pi_/.test(String(o.payment?.paymentIntentId || ""))) feesMissing += 1;
        margin += f.profit;

        // Realized: the same figure, restricted to orders that have shipped.
        if (f.profitRealized) {
          earned += f.profit;
          earnedOrders += 1;
        }
      }

      return { revenue, cost, tax, shipping, cardFees, refunds, feesMissing, margin, earned, earnedOrders, uncostable };
    };

    const current = totalsFor(orders);
    const prior = totalsFor(priorOrders);

    const trendFor = (curr: number, prev: number) =>
      prev === 0
        ? { trendPct: null as number | null, comparable: false, priorAmount: 0 }
        : {
            trendPct: Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1)),
            comparable: true,
            priorAmount: Number(prev.toFixed(2))
          };

    // ── Revenue by region ────────────────────────────────────────────────────
    /*
     * Attributed to the CUSTOMER's region — where the demand is — not to the
     * assigned partner's first served region, which is what this used. Those
     * differ on any cross-region job, so revenue was credited to whichever
     * region printed it rather than the one that bought it.
     */
    const regionMap: Record<string, number> = {};
    for (const o of orders) {
      const region = resolveOrderRegion(o, userRegionMap) || "Unknown";
      regionMap[region] = (regionMap[region] || 0) + ((o.pricing?.total as number) || 0);
    }
    const regionTotal = Object.values(regionMap).reduce((a, b) => a + b, 0);
    const byRegion = Object.entries(regionMap)
      .map(([region, value]) => ({
        region,
        value: Number(value.toFixed(2)),
        percentage: regionTotal > 0 ? Number(((value / regionTotal) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.value - a.value);

    // ── Revenue over time ────────────────────────────────────────────────────
    const bucketCount = Math.max(1, range.buckets);
    const bucketMs = (now.getTime() - startDate.getTime()) / bucketCount;
    const priorBucketMs = (priorEndDate.getTime() - priorStartDate.getTime()) / bucketCount;

    const currentBuckets = new Array(bucketCount).fill(0);
    const priorBuckets = new Array(bucketCount).fill(0);

    const placeInto = (buckets: number[], windowStart: Date, slotMs: number, when: Date, amount: number) => {
      if (slotMs <= 0) return;
      const idx = Math.floor((when.getTime() - windowStart.getTime()) / slotMs);
      // Clamped so an order on the closing edge counts in the last slot rather
      // than being written to an unreachable index and disappearing.
      buckets[Math.min(Math.max(idx, 0), buckets.length - 1)] += amount;
    };

    const revenueOf = (o: any) => (o.pricing?.total || 0) as number;
    for (const o of orders) placeInto(currentBuckets, startDate, bucketMs, o.createdAt as Date, revenueOf(o));
    for (const o of priorOrders) placeInto(priorBuckets, priorStartDate, priorBucketMs, o.createdAt as Date, revenueOf(o));

    const labelFor = (index: number) => {
      const at = new Date(startDate.getTime() + index * bucketMs);
      return rangeKey === "ytd"
        ? at.toLocaleDateString("en-US", { month: "short" })
        : at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const points = currentBuckets.map((value, i) => ({
      label: labelFor(i),
      current: Number(value.toFixed(2)),
      previous: Number(priorBuckets[i].toFixed(2))
    }));

    res.json({
      period: {
        range: rangeKey,
        label: range.label,
        priorLabel: range.priorLabel,
        orderCount: orders.length
      },
      kpis: {
        revenue: { value: Number(current.revenue.toFixed(2)), ...trendFor(current.revenue, prior.revenue) },
        partnerCost: { value: Number(current.cost.toFixed(2)), ...trendFor(current.cost, prior.cost) },
        // What revenue carries that is not the business's, so the page can show
        // revenue − these − partner cost = margin.
        deductions: {
          tax: Number(current.tax.toFixed(2)),
          shipping: Number(current.shipping.toFixed(2)),
          cardFees: Number(current.cardFees.toFixed(2)),
          refunds: Number(current.refunds.toFixed(2)),
          ordersWithoutFee: current.feesMissing,
        },
        margin: {
          value: Number(current.margin.toFixed(2)),
          pct: current.revenue > 0 ? Number(((current.margin / current.revenue) * 100).toFixed(1)) : 0,
          ...trendFor(current.margin, prior.margin)
        },
        // Distinct from margin, which is the point: it is only earned once the
        // order has shipped.
        earned: {
          value: Number(current.earned.toFixed(2)),
          orderCount: current.earnedOrders,
          ...trendFor(current.earned, prior.earned)
        }
      },
      uncostableOrders: current.uncostable,
      chart: { points },
      byRegion
    });
  } catch (error) {
    next(error);
  }
};
