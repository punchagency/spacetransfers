import { Order } from "../models/order.model.js";
import mongoose from "mongoose";

export const getDashboardStats = async (req, res, next) => {
  try {
    const printerId = req.user.id;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);
    yesterdayEnd.setMilliseconds(-1);

    // Fetch orders for stats calculation (Today and Yesterday)
    const printerOrders = await Order.find({ 
      assignedPrinter: printerId,
      updatedAt: { $gte: yesterdayStart }
    });

    // 1. Today's Earnings
    const todayCompleted = printerOrders.filter(o => o.status === "COMPLETED" && o.updatedAt >= todayStart);
    const todayEarnings = todayCompleted.reduce((sum, o) => sum + (o.pricing?.total || 0), 0);

    const yesterdayCompleted = printerOrders.filter(o => o.status === "COMPLETED" && o.updatedAt >= yesterdayStart && o.updatedAt <= yesterdayEnd);
    const yesterdayEarnings = yesterdayCompleted.reduce((sum, o) => sum + (o.pricing?.total || 0), 0);

    // 2. Completed Orders
    const completedTodayCount = todayCompleted.length;
    const completedYesterdayCount = yesterdayCompleted.length;

    // 3. Pending Orders
    const totalPendingCount = await Order.countDocuments({ assignedPrinter: printerId, status: "PENDING" });
    const yesterdayPendingCount = await Order.countDocuments({ 
      assignedPrinter: printerId, 
      status: "PENDING",
      createdAt: { $lt: todayStart }
    });

    // 4. Total Revenue
    const totalRevenueResult = await Order.aggregate([
      { $match: { assignedPrinter: new mongoose.Types.ObjectId(printerId), status: "COMPLETED" } },
      { $group: { _id: null, total: { $sum: "$pricing.total" } } }
    ]);
    const totalRevenue = totalRevenueResult[0]?.total || 0;

    const lastMonthStart = new Date(now);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    const totalRevenueLastMonthResult = await Order.aggregate([
      { $match: { 
          assignedPrinter: new mongoose.Types.ObjectId(printerId), 
          status: "COMPLETED",
          updatedAt: { $lt: todayStart }
      } },
      { $group: { _id: null, total: { $sum: "$pricing.total" } } }
    ]);
    const totalRevenueBeforeToday = totalRevenueLastMonthResult[0]?.total || 0;

    // Helper to calculate trend
    const getTrend = (current, previous) => {
      if (!previous || previous === 0) return { trend: "0%", trendUp: true };
      const diff = ((current - previous) / previous) * 100;
      const prefix = diff > 0 ? "+" : "";
      return {
        trend: `${prefix}${Math.round(diff)}%`,
        trendUp: diff >= 0
      };
    };

    const earningsTrend = getTrend(todayEarnings, yesterdayEarnings);
    const completedTrend = getTrend(completedTodayCount, completedYesterdayCount);
    const revenueTrend = getTrend(totalRevenue, totalRevenueBeforeToday);

    // Urgent Jobs
    const urgentJobs = await Order.find({ 
      assignedPrinter: printerId,
      priority: "URGENT",
      status: { $in: ["PENDING", "PROCESSING"] }
    }).sort({ createdAt: 1 }).limit(5);

    const formattedUrgentJobs = urgentJobs.map(job => ({
      id: job.id,
      customerName: `${job.customer.firstName} ${job.customer.lastName}`,
      order: `${job.items.length} Items`,
      deadline: job.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", 2:00 PM",
      status: "Urgent"
    }));

    res.json({
      cards: [
        { 
          label: "Today's Earnings", 
          value: `$${todayEarnings.toLocaleString()}`, 
          ...earningsTrend
        },
        { 
          label: "Completed Orders", 
          value: completedTodayCount.toLocaleString(), 
          ...completedTrend
        },
        { 
          label: "Pending Orders", 
          value: totalPendingCount.toLocaleString(), 
          trend: `${totalPendingCount - yesterdayPendingCount > 0 ? "+" : ""}${totalPendingCount - yesterdayPendingCount} since yesterday`, 
          trendUp: totalPendingCount >= yesterdayPendingCount 
        },
        { 
          label: "Total Revenue", 
          value: `$${totalRevenue.toLocaleString()}`,
          ...revenueTrend
        }
      ],
      urgentJobs: formattedUrgentJobs
    });
  } catch (error) {
    next(error);
  }
};

export const listPrintQueue = async (req, res, next) => {
  try {
    const printerId = req.user.id;
    const { status } = req.query;

    const query = {
      assignedPrinter: printerId
    };

    if (status) {
      const normalizedStatus = status.trim().toLowerCase();
      if (normalizedStatus === "urgent") {
        query.priority = "URGENT";
      } else {
        // Map frontend statuses to backend Order statuses
        const statusMap = {
          pending: "PENDING",
          processing: "PROCESSING",
          printing: "PRINTING", // Assuming PRINTING is a valid status
          "quality-check": "QUALITY_CHECK", // Assuming QUALITY_CHECK is a valid status
          completed: "COMPLETED"
        };
        const backendStatus = statusMap[normalizedStatus];
        if (backendStatus) {
          query.status = backendStatus;
        }
      }
    }

    const jobs = await Order.find(query)
      .sort({ createdAt: 1, priority: -1 }) // Deadline ASC (using createdAt), Priority DESC
      .limit(100); // Add a reasonable limit

    const formattedJobs = jobs.map(job => {
      const firstItem = job.items[0] || {};
      const sheetSize = (firstItem.widthIn && firstItem.heightIn) 
        ? `${firstItem.widthIn}x${firstItem.heightIn}` 
        : "N/A";

      return {
        id: job.id,
        orderId: job.id, // Using job.id as orderId for now
        customer: `${job.customer.firstName} ${job.customer.lastName}`,
        sheetSize,
        orderDescription: firstItem.name || "N/A",
        status: job.status,
        deadline: job.createdAt.toISOString(), // Using createdAt as deadline
        priority: job.priority
      };
    });

    res.json({ jobs: formattedJobs });
  } catch (error) {
    next(error);
  }
};

export const updateJobStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { status } = req.body;
    const printerId = req.user.id;

    const allowedStatuses = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "COMPLETED"];
    if (!status || !allowedStatuses.includes(status)) {
      const error = new Error("Invalid status provided");
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    job.status = status;
    job.statusTimeline.push({ status, time: new Date() });
    await job.save();

    res.json({
      id: job.id,
      status: job.status,
      updatedAt: job.updatedAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const updateJobPriority = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { priority } = req.body;
    const printerId = req.user.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    if (priority === "Urgent") {
      job.priority = "URGENT";
    } else if (priority === null) {
      job.priority = "NORMAL";
    } else {
      const error = new Error("Invalid priority value. Must be 'Urgent' or null.");
      error.statusCode = 400;
      throw error;
    }

    await job.save();

    res.json({
      id: job.id,
      priority: job.priority
    });
  } catch (error) {
    next(error);
  }
};

export const getJobDetails = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    const firstItem = job.items[0] || {};
    const sheetSize = (firstItem.widthIn && firstItem.heightIn) 
      ? `${firstItem.widthIn}x${firstItem.heightIn}` 
      : "N/A";

    res.json({
      id: job.id,
      orderId: job.id,
      status: job.status,
      specs: {
        sheetSize,
        filmType: firstItem.type === "gangsheet" ? "DTF" : "Unknown"
      },
      notes: job.notes || "No production notes",
      timeline: job.statusTimeline.map(t => ({
        status: t.status,
        time: t.time
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const getJobCustomerInfo = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    const customer = job.customer || {};
    const shippingAddress = job.shippingAddress || {};

    res.json({
      name: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
      email: customer.email || "N/A",
      phone: customer.phone || "N/A",
      shippingAddress: {
        street: shippingAddress.street || "N/A",
        city: shippingAddress.city || "N/A",
        state: shippingAddress.state || "N/A",
        postalCode: shippingAddress.postalCode || "N/A",
        country: shippingAddress.country || "N/A"
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateJobNotes = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { notes } = req.body;
    const printerId = req.user.id;

    if (typeof notes !== "string") {
      const error = new Error("Notes must be a string");
      error.statusCode = 400;
      throw error;
    }

    if (notes.length > 2000) {
      const error = new Error("Notes maximum length is 2000 characters");
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    job.notes = notes;
    await job.save();

    res.json({
      id: job.id,
      notes: job.notes,
      updatedAt: job.updatedAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const updateJobSpecs = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { filmType, passes, temperatureC, pressSeconds } = req.body;
    const printerId = req.user.id;

    const allowedFilmTypes = ["DTF", "UV", "Screen", "Sublimation"];
    if (filmType && !allowedFilmTypes.includes(filmType)) {
      const error = new Error("Invalid filmType. Must be one of: DTF | UV | Screen | Sublimation.");
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    // Initialize specs if it doesn't exist
    if (!job.specs) {
      job.specs = {};
    }

    // Update only allowed fields, ignore unknown fields in req.body
    if (filmType !== undefined) job.specs.filmType = filmType;
    if (passes !== undefined) job.specs.passes = passes;
    if (temperatureC !== undefined) job.specs.temperatureC = temperatureC;
    if (pressSeconds !== undefined) job.specs.pressSeconds = pressSeconds;

    // Mark as modified to ensure Mongoose saves the nested object
    job.markModified("specs");
    await job.save();

    res.json({
      id: job.id,
      specs: job.specs,
      updatedAt: job.updatedAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const executeJobAction = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { action, reason } = req.body;
    const printerId = req.user.id;

    const allowedActions = ["ACCEPT", "REJECT", "START", "PAUSE", "RESUME"];
    if (!action || !allowedActions.includes(action)) {
      const error = new Error("Invalid action. Must be one of: ACCEPT | REJECT | START | PAUSE | RESUME");
      error.statusCode = 400;
      throw error;
    }

    if (action === "REJECT" && !reason) {
      const error = new Error("REJECT requires a reason field");
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    let nextStatus;
    switch (action) {
      case "ACCEPT":
        if (job.status !== "PENDING") {
          const error = new Error(`Cannot ACCEPT job in ${job.status} state. ACCEPT transitions Pending -> Processing.`);
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PROCESSING";
        break;
      case "REJECT":
        if (job.status !== "PENDING") {
          const error = new Error(`Cannot REJECT job in ${job.status} state. REJECT transitions Pending -> Rejected.`);
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "REJECTED";
        job.rejectionReason = reason;
        break;
      case "START":
        if (job.status !== "PROCESSING") {
          const error = new Error(`Cannot START job in ${job.status} state. START transitions Processing -> Printing.`);
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PRINTING";
        break;
      case "PAUSE":
        if (job.status !== "PRINTING") {
          const error = new Error(`Cannot PAUSE job in ${job.status} state. PAUSE transitions Printing -> Paused.`);
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PAUSED";
        break;
      case "RESUME":
        if (job.status !== "PAUSED") {
          const error = new Error(`Cannot RESUME job in ${job.status} state. RESUME transitions Paused -> Printing.`);
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PRINTING";
        break;
    }

    job.status = nextStatus;
    job.statusTimeline.push({ status: nextStatus, time: new Date() });
    await job.save();

    res.json({
      id: job.id,
      status: job.status
    });
  } catch (error) {
    next(error);
  }
};

export const listPrinterOrders = async (req, res, next) => {
  try {
    res.json({ message: "Printer list orders blueprint" });
  } catch (error) {
    next(error);
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           

export const getPrinterEarnings = async (req, res, next) => {
  try {
    res.json({ message: "Printer earnings blueprint" });
  } catch (error) {
    next(error);
  }
};
