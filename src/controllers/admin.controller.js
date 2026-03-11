import mongoose from "mongoose";
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

export const getRevenueChart = async (req, res, next) => {
  try {
    const { range = "30d" } = req.query;

    let startDate;
    const now = new Date();
    now.setHours(23, 59, 59, 999); // End of today

    if (range === "7d") {
      startDate = new Date(new Date().setDate(now.getDate() - 6));
    } else if (range === "90d") {
      startDate = new Date(new Date().setDate(now.getDate() - 89));
    } else if (range === "ytd") {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      // Default 30d
      startDate = new Date(new Date().setDate(now.getDate() - 29));
    }
    startDate.setHours(0, 0, 0, 0);

    const orders = await Order.find({
      createdAt: { $gte: startDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    }).select("pricing.total createdAt");

    const dailyRevenue = {};
    orders.forEach(order => {
      const dateKey = order.createdAt.toISOString().split("T")[0];
      dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + (order.pricing?.total || 0);
    });

    const points = [];
    const tempDate = new Date(startDate);
    while (tempDate <= now) {
      const key = tempDate.toISOString().split("T")[0];
      points.push({
        date: key,
        revenue: Number((dailyRevenue[key] || 0).toFixed(2))
      });
      tempDate.setDate(tempDate.getDate() + 1);
    }

    res.json({
      points,
      currency: "USD"
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req, res, next) => {
  try {
    const { 
      status, 
      partnerId, 
      search, 
      cursor, 
      limit = 20 
    } = req.query;

    const query = {};

    // 1. Filtering by Status
    if (status) {
      // Mapping common UI statuses to DB statuses if they differ
      const statusMap = {
        "Pending": "PENDING",
        "Assigned": "PROCESSING", // Assuming assigned means processing
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status] || status.toUpperCase();
    }

    // 2. Filtering by Partner
    if (partnerId) {
      query.assignedPrinter = partnerId;
    }

    // 3. Search by Order ID or Customer Name
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { "customer.firstName": searchRegex },
        { "customer.lastName": searchRegex },
        { "customer.email": searchRegex }
      ];
      
      // If it looks like a MongoDB ObjectId or a specific order ID pattern
      if (mongoose.Types.ObjectId.isValid(search)) {
        query.$or.push({ _id: search });
      }
    }

    // 4. Cursor-based Pagination
    if (cursor) {
      const [cursorTime, cursorId] = cursor.split("_");
      query.$or = [
        { createdAt: { $lt: new Date(Number(cursorTime)) } },
        { 
          createdAt: new Date(Number(cursorTime)), 
          _id: { $lt: cursorId } 
        }
      ];
    }

    // 5. Fetch Orders
    const pageSize = parseInt(limit);
    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1) // Fetch one extra to check if there's a next page
      .lean();

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    // 6. Format Response
    const formattedOrders = results.map(order => {
      const firstItem = order.items?.[0] || {};
      const sheetSize = firstItem.widthIn && firstItem.heightIn 
        ? `${firstItem.widthIn}" x ${firstItem.heightIn}"`
        : "N/A";

      return {
        id: order._id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        status: order.status,
        createdAt: order.createdAt,
        assignedPartnerId: order.assignedPrinter || null,
        sheetSize,
        isUrgent: order.priority === "URGENT"
      };
    });

    // 7. Generate Next Cursor
    let nextCursor = null;
    if (hasNextPage) {
      const lastOrder = results[results.length - 1];
      nextCursor = `${lastOrder.createdAt.getTime()}_${lastOrder._id}`;
    }

    res.status(200).json({
      orders: formattedOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate("assignedPrinter", "companyName email regions")
      .lean();

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    // Helper to calculate cost for financials section
    const calculateItemCost = (item) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    let totalPartnerCost = 0;
    const formattedItems = (order.items || []).map(item => {
      const itemCost = calculateItemCost(item);
      totalPartnerCost += itemCost;
      
      return {
        name: item.name,
        size: item.widthIn && item.heightIn ? `${item.widthIn}" x ${item.heightIn}"` : "Custom",
        quantity: item.quantity,
        price: item.unitPrice,
        subtotal: item.subtotal
      };
    });

    const customerPaid = order.pricing?.total || 0;
    const adminProfit = customerPaid - totalPartnerCost;

    // Format the response according to the UI requirements
    const orderSummary = {
      id: order._id,
      status: order.status,
      createdAt: order.createdAt,
      
      customer: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        email: order.customer?.email || "N/A",
        phone: order.customer?.phone || "N/A"
      },

      shippingAddress: {
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A",
        region: order.assignedPrinter?.regions?.[0] || "Unknown" // Mapping assigned printer region to shipping region for UI
      },

      items: formattedItems,

      // Timeline based on actual statusTimeline from DB
      statusTimeline: (order.statusTimeline || []).map(entry => ({
        status: entry.status,
        time: entry.time
      })),

      financials: {
        customerPaid: Number(customerPaid.toFixed(2)),
        partnerCost: Number(totalPartnerCost.toFixed(2)),
        adminProfit: Number(adminProfit.toFixed(2)),
        currency: order.pricing?.currency || "USD"
      },

      assignedPartner: order.assignedPrinter ? {
        id: order.assignedPrinter._id,
        name: order.assignedPrinter.companyName,
        email: order.assignedPrinter.email
      } : null,

      // For Gang Sheet Preview (assuming first item's design if available)
      preview: {
        designId: order.items?.[0]?.designId || null,
        sheetSize: formattedItems[0]?.size || "N/A"
      }
    };

    res.status(200).json(orderSummary);
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
    const { range = "30d" } = req.query;

    // 1. Calculate date ranges
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
      priorStartDate = new Date(new Date().getFullYear() - 1, 0, 1);
      priorEndDate = new Date(new Date().getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      startDate = new Date(new Date().setDate(now.getDate() - 30));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 60));
      priorEndDate = startDate;
    }

    // 2. Fetch Orders for KPIs and Table
    const orders = await Order.find({
      createdAt: { $gte: startDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    }).populate("assignedPrinter", "companyName regions");

    const priorOrders = await Order.find({
      createdAt: { $gte: priorStartDate, $lt: priorEndDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    });

    // KPI Calculations
    const calculateItemCost = (item) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; // More realistic base cost
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity; // Fallback per item cost
    };

    const calculateTotals = (orderList) => {
      let revenue = 0;
      let cost = 0;
      orderList.forEach(o => {
        revenue += (o.pricing?.total || 0);
        o.items.forEach(item => {
          cost += calculateItemCost(item);
        });
      });
      return { revenue, cost, profit: revenue - cost };
    };

    const currentTotals = calculateTotals(orders);
    const priorTotals = calculateTotals(priorOrders);

    const calculateTrend = (curr, prior) => {
      if (prior === 0) return curr > 0 ? 100 : 0;
      return Number(((curr - prior) / prior * 100).toFixed(1));
    };

    // 3. Revenue by Region
    const regionMap = {};
    orders.forEach(o => {
      const region = o.assignedPrinter?.regions?.[0] || "Unknown";
      regionMap[region] = (regionMap[region] || 0) + (o.pricing?.total || 0);
    });
    const revenueByRegion = Object.entries(regionMap).map(([region, value]) => ({
      region,
      value: Number(value.toFixed(0)),
      percentage: Number(((value / (currentTotals.revenue || 1)) * 100).toFixed(0))
    })).sort((a, b) => b.value - a.value);

    // 4. Products Table
    const productMap = {};
    orders.forEach(o => {
      o.items.forEach(item => {
        const key = item.name || "Custom Print";
        if (!productMap[key]) {
          productMap[key] = {
            name: key,
            sku: `DTF-${o.id.toString().slice(-4).toUpperCase()}`,
            quantity: 0,
            totalRevenue: 0,
            totalCost: 0
          };
        }
        productMap[key].quantity += (item.quantity || 1);
        productMap[key].totalRevenue += (item.subtotal || 0);
        productMap[key].totalCost += calculateItemCost(item);
      });
    });

    const products = Object.values(productMap).map(p => {
      const profit = p.totalRevenue - p.totalCost;
      const finalPrice = p.totalRevenue / (p.quantity || 1);
      const profitMargin = (profit / (p.totalRevenue || 1)) * 100;
      const baseCost = p.totalCost / (p.quantity || 1);
      const markup = ((finalPrice - baseCost) / (baseCost || 1)) * 100;

      return {
        name: p.name,
        sku: p.sku,
        baseCost: Number(baseCost.toFixed(2)),
        markup: Number(markup.toFixed(1)),
        quantity: p.quantity,
        finalPrice: Number(finalPrice.toFixed(2)),
        totalCost: Number(p.totalCost.toFixed(2)),
        totalRevenue: Number(p.totalRevenue.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        profitMargin: Number(profitMargin.toFixed(2))
      };
    });

    // 5. Revenue Chart (Actual data grouped by time)
    const getTimeLabel = (date) => {
      if (range === "7d") return date.toLocaleDateString("en-US", { weekday: "short" });
      if (range === "ytd") return date.toLocaleDateString("en-US", { month: "short" });
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const currentPointsMap = {};
    const priorPointsMap = {};

    // Group current period orders by time label
    orders.forEach(o => {
      const label = getTimeLabel(o.createdAt);
      currentPointsMap[label] = (currentPointsMap[label] || 0) + (o.pricing?.total || 0);
    });

    // Group prior period orders by time label
    priorOrders.forEach(o => {
      const label = getTimeLabel(o.createdAt);
      priorPointsMap[label] = (priorPointsMap[label] || 0) + (o.pricing?.total || 0);
    });

    // Generate consistent labels for the chart based on the selected range
    const labels = [];
    let tempDate = new Date(startDate);
    const endChartDate = new Date(now);
    
    // Ensure we include the last day/month
    while (tempDate <= endChartDate) {
      labels.push(getTimeLabel(tempDate));
      if (range === "7d") {
        tempDate.setDate(tempDate.getDate() + 1);
      } else if (range === "90d") {
        tempDate.setDate(tempDate.getDate() + 7); // Weekly points for 90d
      } else if (range === "ytd") {
        tempDate.setMonth(tempDate.getMonth() + 1);
      } else {
        tempDate.setDate(tempDate.getDate() + 2); // Every 2 days for 30d
      }
    }

    const chartPoints = labels.map(label => ({
      label,
      current: Number((currentPointsMap[label] || 0).toFixed(0)),
      previous: Number((priorPointsMap[label] || 0).toFixed(0))
    }));

    res.json({
      kpis: {
        totalProfits: { 
          value: Number(currentTotals.profit.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.profit, priorTotals.profit) 
        },
        totalCosts: { 
          value: Number(currentTotals.cost.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.cost, priorTotals.cost) 
        },
        profitEarned: { 
          value: Number(currentTotals.profit.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.profit, priorTotals.profit) 
        },
        totalRevenue: { 
          value: Number(currentTotals.revenue.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.revenue, priorTotals.revenue) 
        }
      },
      revenueChart: {
        currentTotal: Number(currentTotals.revenue.toFixed(0)),
        previousTotal: Number(priorTotals.revenue.toFixed(0)),
        points: chartPoints
      },
      revenueByRegion,
      products
    });
  } catch (error) {
    next(error);
  }
};

