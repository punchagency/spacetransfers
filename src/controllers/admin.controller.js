import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { generatePDF } from "pdf-node";
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

    const calculateOrderFinancials = (order) => {
      const customerCharge = order.pricing?.total || 0;
      
      const partnerPayout = (order.items || []).reduce((total, item) => {
        const { widthIn, heightIn, quantity = 1 } = item;
        if (widthIn && heightIn) {
          const areaSqFt = (widthIn * heightIn) / 144;
          return total + (areaSqFt * 3.50 * quantity);
        }
        return total + (5.00 * quantity);
      }, 0);

      const fees = customerCharge > 0 ? (customerCharge * 0.029) + 0.30 : 0;
      const profit = customerCharge - partnerPayout - fees;
      
      return { customerCharge, partnerPayout, fees, profit };
    };

    const recentOrders = recentOrdersRaw.map(order => {
      const { profit } = calculateOrderFinancials(order);
      return {
        id: order._id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        profits: Number(profit.toFixed(2)),
        status: order.status,
        createdAt: order.createdAt,
        assignedPartner: order.assignedPrinter?.companyName || null
      };
    });

    res.json({
      stats: {
        totalOrders: orders.total,
        pendingOrders: orders.pending,
        activePartners: partners.active,
        totalRevenue: {
          amount: Number(currentRevenue.toFixed(2)),
          trendPct: Number(trendPct.toFixed(1))
        }
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

export const getPartnerPricing = async (req, res, next) => {
  try {
    const { partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      const error = new Error("Invalid Partner ID");
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerId, role: UserRoles.PRINTER })
      .select("settings.pricing")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer");
      error.statusCode = 404;
      throw error;
    }

    const pricing = partner.settings?.pricing || {
      baseRatePerSqFt: 18.00,
      tiered: [
        { minSqFt: 0, maxSqFt: 2, rate: 20.00 },
        { minSqFt: 2, maxSqFt: 5, rate: 18.50 },
        { minSqFt: 5, maxSqFt: null, rate: 17.00 }
      ],
      surcharges: {
        rushPct: 10,
        specialInkFlat: 5.00
      }
    };

    res.status(200).json(pricing);
  } catch (error) {
    next(error);
  }
};

export const updatePartnerPricing = async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    const { baseRatePerSqFt, tiered, surcharges } = req.body;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      const error = new Error("Invalid Partner ID");
      error.statusCode = 404;
      throw error;
    }

    const updateData = {};
    if (baseRatePerSqFt !== undefined) updateData["settings.pricing.baseRatePerSqFt"] = baseRatePerSqFt;
    if (tiered !== undefined) updateData["settings.pricing.tiered"] = tiered;
    if (surcharges !== undefined) updateData["settings.pricing.surcharges"] = surcharges;

    const partner = await User.findOneAndUpdate(
      { _id: partnerId, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("settings.pricing").lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: partner._id,
      updated: true,
      pricing: partner.settings?.pricing
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerSettings = async (req, res, next) => {
  try {
    const { partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      const error = new Error("Invalid Partner ID");
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerId, role: UserRoles.PRINTER })
      .select("settings")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer");
      error.statusCode = 404;
      throw error;
    }

    const settings = partner.settings || {};

    // Map the detailed notification settings to the simplified format
    const notifications = {
      orderAssigned: settings.notifications?.email?.newJobs || false,
      jobCompleted: settings.notifications?.email?.jobUpdates || false
    };

    const capabilities = {
      maxSheetSizeIn: settings.printingCapabilities?.maxSheetSizeIn || { width: 0, height: 0 },
      formats: settings.printingCapabilities?.supportedFormats || [],
      maxDPI: settings.printingCapabilities?.maxResolutionDPI || 0
    };

    res.status(200).json({
      jobCapacity: settings.jobCapacity || { maxConcurrent: 0, dailyMax: 0 },
      notifications,
      capabilities
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerSettings = async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    const { jobCapacity, notifications, capabilities } = req.body;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      const error = new Error("Invalid Partner ID");
      error.statusCode = 404;
      throw error;
    }

    const updateData = {};

    // Map jobCapacity
    if (jobCapacity) {
      if (jobCapacity.maxConcurrent !== undefined) updateData["settings.jobCapacity.maxConcurrent"] = jobCapacity.maxConcurrent;
      if (jobCapacity.dailyMax !== undefined) updateData["settings.jobCapacity.dailyMax"] = jobCapacity.dailyMax;
    }

    // Map notifications
    if (notifications) {
      if (notifications.orderAssigned !== undefined) updateData["settings.notifications.email.newJobs"] = notifications.orderAssigned;
      if (notifications.jobCompleted !== undefined) updateData["settings.notifications.email.jobUpdates"] = notifications.jobCompleted;
    }

    // Map capabilities
    if (capabilities) {
      if (capabilities.maxDPI !== undefined) updateData["settings.printingCapabilities.maxResolutionDPI"] = capabilities.maxDPI;
      if (capabilities.maxSheetSizeIn !== undefined) updateData["settings.printingCapabilities.maxSheetSizeIn"] = capabilities.maxSheetSizeIn;
      if (capabilities.formats !== undefined) updateData["settings.printingCapabilities.supportedFormats"] = capabilities.formats;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerId, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const setOrderTracking = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

    const { carrier, trackingNumber, trackingUrl } = req.body;

    if (!carrier || !trackingNumber) {
      const error = new Error("Carrier and trackingNumber are required");
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderId);
    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    // 1. Update Tracking Info
    order.carrier = carrier;
    order.trackingNumber = trackingNumber;
    order.trackingUrl = trackingUrl;
    order.status = "SHIPPED";

    // 2. Add Timeline Event
    order.statusTimeline.push({
      status: "SHIPPED",
      time: new Date(),
      message: `Order shipped via ${carrier}. Tracking: ${trackingNumber}`
    });

    await order.save();

    res.status(200).json({
      orderId: order._id,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier
    });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

    const { status } = req.body;

    if (!status) {
      const error = new Error("Status is required");
      error.statusCode = 400;
      throw error;
    }

    const statusMap = {
      "Pending": "PENDING",
      "Assigned": "PROCESSING",
      "In Progress": "PRINTING",
      "Shipped": "SHIPPED",
      "Completed": "COMPLETED",
      "Cancelled": "CANCELLED"
    };

    const dbStatus = statusMap[status];
    if (!dbStatus) {
      const error = new Error(`Invalid status value: ${status}`);
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderId);
    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    // 1. Update Status
    order.status = dbStatus;

    // 2. Add Timeline Event
    order.statusTimeline.push({
      status: dbStatus,
      time: new Date(),
      message: `Admin updated status to ${status}`
    });

    await order.save();

    res.status(200).json({
      orderId: order._id,
      status: status, // Return the user-friendly status
      updatedAt: order.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const assignOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

    const { partnerId, priority = "Normal" } = req.body;

    if (!partnerId) {
      const error = new Error("partnerId is required");
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderId);
    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerId, role: UserRoles.PRINTER });
    if (!partner) {
      const error = new Error("Partner not found or is not a printer");
      error.statusCode = 404;
      throw error;
    }

    const previousPartnerId = order.assignedPrinter;
    const isReassignment = previousPartnerId && previousPartnerId.toString() !== partnerId;

    // 1. Update Order
    order.assignedPrinter = partnerId;
    order.priority = priority.toUpperCase();
    order.status = "PROCESSING"; // "Assigned" in UI

    // 2. Add Timeline Event
    const message = isReassignment 
      ? `Order reassigned from previous partner to ${partner.companyName || partner.name}`
      : `Order assigned to ${partner.companyName || partner.name}`;

    order.statusTimeline.push({
      status: "PROCESSING",
      time: new Date(),
      message
    });

    await order.save();

    res.status(200).json({
      orderId: order._id,
      assignedPartnerId: partnerId,
      status: "Assigned"
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

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
    const processingFees = customerPaid > 0 ? (customerPaid * 0.029) + 0.30 : 0;
    const adminProfit = customerPaid - totalPartnerCost - processingFees;

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
        processingFees: Number(processingFees.toFixed(2)),
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

export const exportOrders = async (req, res, next) => {
  try {
    const { from, to, status } = req.query;

    const query = {};
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }
    if (status) {
      // Mapping common UI statuses to DB statuses if they differ
      const statusMap = {
        "Pending": "PENDING",
        "Assigned": "PROCESSING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status] || status.toUpperCase();
    }

    // Set headers for CSV download
    const filename = `orders-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write CSV Header
    const columns = ['orderId', 'customer', 'email', 'status', 'total', 'partner', 'sheetSize', 'createdAt', 'completedAt'];
    res.write(columns.join(',') + '\n');

    // Cursor for large data sets
    const cursor = Order.find(query)
      .populate('assignedPrinter', 'companyName')
      .sort({ createdAt: -1 })
      .cursor();

    for (let order = await cursor.next(); order != null; order = await cursor.next()) {
      const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim();
      const firstItem = order.items?.[0] || {};
      const sheetSize = firstItem.widthIn && firstItem.heightIn 
        ? `${firstItem.widthIn}" x ${firstItem.heightIn}"`
        : 'N/A';
      
      const completedAt = order.status === 'COMPLETED' ? (order.updatedAt || order.createdAt).toISOString() : 'N/A';

      const row = [
        order._id,
        `"${customerName.replace(/"/g, '""')}"`,
        order.customer?.email || 'N/A',
        order.status,
        order.pricing?.total || 0,
        `"${(order.assignedPrinter?.companyName || 'N/A').replace(/"/g, '""')}"`,
        `"${sheetSize}"`,
        order.createdAt.toISOString(),
        completedAt
      ];

      res.write(row.join(',') + '\n');
    }

    res.end();
  } catch (error) {
    next(error);
  }
};

export const createPartner = async (req, res, next) => {
  try {
    const { name, email, phone, regions, capabilities } = req.body;

    // 1. Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error("Partner with this email already exists");
      error.statusCode = 409;
      throw error;
    }

    // 2. Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // 3. Create Partner (PRINTER role)
    const newPartner = new User({
      name,
      companyName: name, // Using name as companyName if not provided
      email,
      phone,
      regions,
      role: UserRoles.PRINTER,
      status: "Active",
      passwordHash,
      settings: {
        printingCapabilities: {
          maxSheetSizeIn: capabilities?.maxSheetSizeIn || { width: 24, height: 19.5 },
          supportedFormats: capabilities?.formats || ["PNG", "PDF", "TIFF"],
          maxResolutionDPI: capabilities?.maxDPI || 1200
        }
      }
    });

    await newPartner.save();

    // 4. Send Welcome Email (Mocked)
    console.log(`[EMAIL MOCK] Welcome email sent to ${email} with temporary password: ${tempPassword}`);

    res.status(201).json({
      id: newPartner._id,
      status: newPartner.status
    });
  } catch (error) {
    next(error);
  }
};

export const listPartners = async (req, res, next) => {
  try {
    const { status, search, cursor, limit = 20 } = req.query;
    const pageSize = parseInt(limit);

    // Initial match query
    const matchQuery = { role: UserRoles.PRINTER };

    if (status) {
      matchQuery.status = status;
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      matchQuery.$or = [
        { name: searchRegex },
        { companyName: searchRegex },
        { email: searchRegex }
      ];
    }

    // Aggregation pipeline to get ordersCompleted
    const pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "orders",
          let: { partnerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$assignedPrinter", "$$partnerId"] },
                    { $eq: ["$status", "COMPLETED"] }
                  ]
                }
              }
            },
            { $count: "count" }
          ],
          as: "completedCountArr"
        }
      },
      {
        $addFields: {
          ordersCompleted: { $ifNull: [{ $arrayElemAt: ["$completedCountArr.count", 0] }, 0] }
        }
      },
      { $project: { passwordHash: 0, completedCountArr: 0 } },
      // Sorting: ordersCompleted DESC, then _id DESC for stability
      { $sort: { ordersCompleted: -1, _id: -1 } }
    ];

    // Cursor-based pagination logic within aggregation
    if (cursor) {
      const [cursorValue, cursorId] = cursor.split("_");
      pipeline.push({
        $match: {
          $or: [
            { ordersCompleted: { $lt: parseInt(cursorValue) } },
            {
              ordersCompleted: parseInt(cursorValue),
              _id: { $lt: new mongoose.Types.ObjectId(cursorId) }
            }
          ]
        }
      });
    }

    // Limit to pageSize + 1 to check for next page
    pipeline.push({ $limit: pageSize + 1 });

    const partners = await User.aggregate(pipeline);

    const hasNextPage = partners.length > pageSize;
    const results = hasNextPage ? partners.slice(0, pageSize) : partners;

    // Map _id to id for the response
    const formattedPartners = results.map(p => ({
      id: p._id,
      name: p.companyName || p.name,
      status: p.status,
      regions: p.regions || [],
      rating: p.rating || 5.0,
      ordersCompleted: p.ordersCompleted
    }));

    let nextCursor = null;
    if (hasNextPage) {
      const lastPartner = results[results.length - 1];
      nextCursor = `${lastPartner.ordersCompleted}_${lastPartner._id}`;
    }

    res.status(200).json({
      partners: formattedPartners,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerById = async (req, res, next) => {
  try {
    const { partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      const error = new Error("Invalid Partner ID");
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerId, role: UserRoles.PRINTER })
      .select("-passwordHash")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found");
      error.statusCode = 404;
      throw error;
    }

    // Calculate completed orders count
    const ordersCompleted = await Order.countDocuments({
      assignedPrinter: partnerId,
      status: "COMPLETED"
    });

    res.status(200).json({
      id: partner._id,
      name: partner.companyName || partner.name,
      status: partner.status,
      regions: partner.regions || [],
      ordersCompleted,
      rating: partner.rating || 5.0,
      email: partner.email,
      phone: partner.phone || "N/A"
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerOrders = async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    const { status, cursor, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      const error = new Error("Invalid Partner ID");
      error.statusCode = 404;
      throw error;
    }

    const query = { assignedPrinter: partnerId };

    if (status) {
      // Map common UI status to DB status if needed
      const statusMap = {
        "Pending": "PENDING",
        "Assigned": "PROCESSING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status] || status.toUpperCase();
    }

    // Cursor-based pagination logic
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

    const pageSize = parseInt(limit);
    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    const formattedOrders = results.map(order => ({
      id: order._id,
      status: order.status, // Can be mapped to UI label if preferred
      customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
      total: order.pricing?.total || 0,
      createdAt: order.createdAt
    }));

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

export const updatePartner = async (req, res, next) => {
  try {
    const { partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      const error = new Error("Invalid Partner ID");
      error.statusCode = 404;
      throw error;
    }

    const updateData = req.body;

    // Prevent updating sensitive fields via this endpoint if necessary
    delete updateData.passwordHash;
    delete updateData.role;

    const partner = await User.findOneAndUpdate(
      { _id: partnerId, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!partner) {
      const error = new Error("Partner not found");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: partner._id,
      updated: true
    });
  } catch (error) {
    next(error);
  }
};

export const adjustOrderFinancials = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

    const { adjustments } = req.body;

    if (!Array.isArray(adjustments) || adjustments.length === 0) {
      const error = new Error("Adjustments array is required and cannot be empty");
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderId);

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    // 1. Apply adjustments to pricing
    if (!order.pricing.adjustments) {
      order.pricing.adjustments = [];
    }

    let totalAdjustment = 0;
    adjustments.forEach(adj => {
      const { type, amount, reason } = adj;
      
      if (!["discount", "surcharge", "credit", "fee"].includes(type)) {
        const error = new Error(`Invalid adjustment type: ${type}`);
        error.statusCode = 400;
        throw error;
      }

      if (typeof amount !== "number" || amount <= 0) {
        const error = new Error("Adjustment amount must be a positive number");
        error.statusCode = 400;
        throw error;
      }

      order.pricing.adjustments.push({ type, amount, reason, createdAt: new Date() });

      // Calculate the net impact on the total
      if (type === "discount" || type === "credit") {
        totalAdjustment -= amount;
      } else {
        totalAdjustment += amount;
      }

      // 2. Log to timeline
      order.statusTimeline.push({
        status: order.status, // Keep current status but log the event
        time: new Date(),
        message: `Financial adjustment: ${type.toUpperCase()} of ${amount} applied. Reason: ${reason}`
      });
    });

    // 3. Update the total
    order.pricing.total = Math.max(0, order.pricing.total + totalAdjustment);
    
    await order.save();

    // 4. Calculate new margin
    const calculateItemCost = (item) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    const partnerPayout = (order.items || []).reduce((total, item) => total + calculateItemCost(item), 0);
    const fees = order.pricing.total > 0 ? (order.pricing.total * 0.029) + 0.30 : 0;
    const margin = order.pricing.total - partnerPayout - fees;

    res.status(200).json({
      customerCharge: Number(order.pricing.total.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      currency: order.pricing.currency
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderFinancials = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderId).lean();

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    // 1. Customer Charge (Total from pricing)
    const customerCharge = order.pricing?.total || 0;

    // 2. Partner Payout (Calculated using $3.50/sq ft base cost)
    const calculateItemCost = (item) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    const partnerPayout = (order.items || []).reduce((total, item) => total + calculateItemCost(item), 0);

    // 3. Fees (Standard payment processing fee: 2.9% + $0.30)
    const fees = customerCharge > 0 ? (customerCharge * 0.029) + 0.30 : 0;

    // 4. Admin Margin (customerCharge - partnerPayout - fees)
    const margin = customerCharge - partnerPayout - fees;

    res.status(200).json({
      customerCharge: Number(customerCharge.toFixed(2)),
      partnerPayout: Number(partnerPayout.toFixed(2)),
      fees: Number(fees.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      currency: order.pricing?.currency || "USD"
    });
  } catch (error) {
    next(error);
  }
};

export const downloadOrderInvoice = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderId);

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    const invoiceTemplatePath = path.join(process.cwd(), "src", "templates", "invoice.html");
    const htmlTemplate = fs.readFileSync(invoiceTemplatePath, "utf8");

    const formattedItems = (order.items || []).map((item) => {
      let description = "";
      if (item.widthIn && item.heightIn) {
        description = `${item.widthIn}" x ${item.heightIn}"`;
      }
      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: (item.unitPrice || 0).toFixed(2),
        subtotal: (item.subtotal || 0).toFixed(2)
      };
    });

    const pricing = order.pricing || {};
    const lineItems = [
      { label: "Subtotal", amount: (pricing.subtotal || 0).toFixed(2) },
      { label: "Shipping", amount: (pricing.shippingCost || 0).toFixed(2) },
      { label: "Tax", amount: (pricing.tax || 0).toFixed(2) }
    ];

    // Include adjustments in the invoice if any
    if (pricing.adjustments && pricing.adjustments.length > 0) {
      pricing.adjustments.forEach(adj => {
        const label = adj.type.charAt(0).toUpperCase() + adj.type.slice(1);
        const amount = (adj.type === "discount" || adj.type === "credit") ? -adj.amount : adj.amount;
        lineItems.push({ label: `${label} (${adj.reason})`, amount: amount.toFixed(2) });
      });
    }

    const data = {
      orderId: order._id,
      date: (order.createdAt || new Date()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      shippingAddress: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Valued Customer",
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A"
      },
      items: formattedItems,
      pricing: {
        lineItems,
        total: (pricing.total || 0).toFixed(2),
        currency: pricing.currency || "USD"
      }
    };

    const pdfOptions = {
      format: "A4",
      printBackground: true
    };

    const result = await generatePDF({
      html: htmlTemplate,
      data: data,
      type: "pdf",
      buffer: true,
      pdfOptions: pdfOptions
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${order._id}.pdf"`);
    res.send(result.buffer);

  } catch (error) {
    next(error);
  }
};

export const getOrderTimeline = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Invalid Order ID");
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderId)
      .populate("assignedPrinter", "companyName")
      .lean();

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }
 
    let events = [];

    // 1. Order Creation Event
    events.push({
      time: order.createdAt,
      who: "Customer",
      type: "Created",
      message: "Order placed"
    });

    // 2. Status Change Events
    if (order.statusTimeline && order.statusTimeline.length > 0) {
      order.statusTimeline.forEach(entry => {
        let who = "System";
        let message = `Status updated to ${entry.status}`;

        if (entry.status === "PROCESSING" && order.assignedPrinter) {
          who = "Admin";
          message = `Assigned to ${order.assignedPrinter.companyName}`;
        } else if (["PRINTING", "QUALITY_CHECK"].includes(entry.status)) {
          who = "Printer";
        } else if (entry.status === "REJECTED") {
          who = "Admin";
          message = `Order rejected. Reason: ${order.rejectionReason || "Not specified"}`;
        }

        events.push({
          time: entry.time,
          who,
          type: entry.status.charAt(0).toUpperCase() + entry.status.slice(1).toLowerCase(),
          message
        });
      });
    }

    // 3. Tracking Events
    if (order.trackingEvents && order.trackingEvents.length > 0) {
      order.trackingEvents.forEach(event => {
        events.push({
          time: event.time,
          who: "Printer",
          type: "Shipped",
          message: `${event.description} at ${event.location}`
        });
      });
    }

    // 4. Sort all events chronologically
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    res.status(200).json({ events });

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
      let payout = 0;
      let fees = 0;
      
      orderList.forEach(o => {
        const orderRevenue = (o.pricing?.total || 0);
        revenue += orderRevenue;
        
        // Partner payout
        o.items.forEach(item => {
          payout += calculateItemCost(item);
        });

        // Processing fees
        if (orderRevenue > 0) {
          fees += (orderRevenue * 0.029) + 0.30;
        }
      });

      const totalCost = payout + fees;
      return { revenue, cost: totalCost, profit: revenue - totalCost };
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

