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

