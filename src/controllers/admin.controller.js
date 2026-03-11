import { Order } from "../models/order.model.js";
import { User, UserRoles } from "../models/user.model.js";

export const getAdminDashboardStats = async (req, res, next) => {
  try {
    const { range = "30d" } = req.query;

    let startDate;
    let priorStartDate;
    let priorEndDate;
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
      // Trend for YTD compares to same period last year
      priorStartDate = new Date(new Date().getFullYear() - 1, 0, 1);
      priorEndDate = new Date(new Date().getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      // Default 30d
      startDate = new Date(new Date().setDate(now.getDate() - 30));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 60));
      priorEndDate = startDate;
    }

    // 1. Order Stats (All time or filtered by range? The prompt says "Stats aggregate across all partners and customers", usually dashboard totals are for the selected range)
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
    delete orders._id;

    // 2. Revenue Stats
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
    const currentCount = revenueStats[0].current[0]?.count || 0;
    const priorRevenue = revenueStats[0].prior[0]?.total || 0;

    let trendPct = 0;
    if (priorRevenue > 0) {
      trendPct = ((currentRevenue - priorRevenue) / priorRevenue) * 100;
    } else if (currentRevenue > 0) {
      trendPct = 100;
    }

    // 3. Partner Stats
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
    delete partners._id;

    // 4. Recent Orders
    const recentOrdersRaw = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("assignedPrinter", "companyName regions");

    const recentOrders = recentOrdersRaw.map(order => {
      const profits = (order.pricing?.total || 0) * 0.20; // 20% platform profit
      return {
        orderId: `#ORD-${order.id.toString().slice(-4).toUpperCase()}`,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        region: order.assignedPrinter?.regions?.[0] || "N/A",
        partner: order.assignedPrinter?.companyName || "Unassigned",
        status: order.status,
        amount: order.pricing?.total || 0,
        profits: Number(profits.toFixed(2)),
        date: order.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      };
    });

    res.json({
      totalOrders: {
        count: orders.total,
        trendPct: Number(trendPct.toFixed(1)) // Using revenue trend as a proxy for now
      },
      completedOrders: {
        count: orders.completed,
        trendPct: 8.0 // Mocked trend
      },
      profitEarned: {
        amount: Number((currentRevenue * 0.20).toFixed(2)),
        trendPct: Number(trendPct.toFixed(1))
      },
      totalRevenue: {
        amount: Number(currentRevenue.toFixed(2)),
        trendPct: Number(trendPct.toFixed(1))
      },
      recentOrders
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req, res, next) => {
  try {
    res.json({ message: "Admin list orders blueprint" });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    res.json({ message: "Admin get order by id blueprint" });
  } catch (error) {
    next(error);
  }
};

export const listPartners = async (req, res, next) => {
  try {
    res.json({ message: "Admin list partners blueprint" });
  } catch (error) {
    next(error);
  }
};

export const updatePartner = async (req, res, next) => {
  try {
    res.json({ message: "Admin update partner blueprint" });
  } catch (error) {
    next(error);
  }
};

export const getEarningsSummary = async (req, res, next) => {
  try {
    res.json({ message: "Admin earnings summary blueprint" });
  } catch (error) {
    next(error);
  }
};

