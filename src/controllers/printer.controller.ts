import { Request, Response, NextFunction } from "express";
import { Order } from "../models/order.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
import { User } from "../models/user.model.js";
import mongoose from "mongoose";
import { env } from "../config/env.js";

interface CustomError extends Error {
  statusCode?: number;
}

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);
    yesterdayEnd.setMilliseconds(-1);

    const printerOrders = await Order.find({ 
      assignedPrinter: printerId,
      updatedAt: { $gte: yesterdayStart }
    });

    const todayCompleted = printerOrders.filter(o => o.status === "COMPLETED" && o.updatedAt >= todayStart);
    const todayEarnings = todayCompleted.reduce((sum, o) => sum + (o.pricing?.total || 0), 0);

    const yesterdayCompleted = printerOrders.filter(o => o.status === "COMPLETED" && o.updatedAt >= yesterdayStart && o.updatedAt <= yesterdayEnd);
    const yesterdayEarnings = yesterdayCompleted.reduce((sum, o) => sum + (o.pricing?.total || 0), 0);

    const completedTodayCount = todayCompleted.length;
    const completedYesterdayCount = yesterdayCompleted.length;

    const totalPendingCount = await Order.countDocuments({ assignedPrinter: printerId, status: "PENDING" });
    const yesterdayPendingCount = await Order.countDocuments({ 
      assignedPrinter: printerId, 
      status: "PENDING",
      createdAt: { $lt: todayStart }
    });

    const totalRevenueResult = await Order.aggregate([
      { $match: { assignedPrinter: new mongoose.Types.ObjectId(printerId), status: "COMPLETED" } },
      { $group: { _id: null, total: { $sum: "$pricing.total" } } }
    ]);
    const totalRevenue = totalRevenueResult[0]?.total || 0;

    const totalRevenueLastMonthResult = await Order.aggregate([
      { $match: { 
          assignedPrinter: new mongoose.Types.ObjectId(printerId), 
          status: "COMPLETED",
          updatedAt: { $lt: todayStart }
      } },
      { $group: { _id: null, total: { $sum: "$pricing.total" } } }
    ]);
    const totalRevenueBeforeToday = totalRevenueLastMonthResult[0]?.total || 0;

    const getTrend = (current: number, previous: number) => {
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

export const listPrintQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { status } = req.query;

    const query: any = {
      assignedPrinter: printerId
    };

    if (status) {
      const normalizedStatus = (status as string).trim().toLowerCase();
      if (normalizedStatus === "urgent") {
        query.priority = "URGENT";
      } else {
        const statusMap: { [key: string]: string } = {
          pending: "PENDING",
          processing: "PROCESSING",
          printing: "PRINTING",
          "quality-check": "QUALITY_CHECK",
          completed: "COMPLETED"
        };
        const backendStatus = statusMap[normalizedStatus];
        if (backendStatus) {
          query.status = backendStatus;
        }
      }
    }

    const jobs = await Order.find(query)
      .sort({ createdAt: 1, priority: -1 })
      .limit(100);

    const formattedJobs = jobs.map(job => {
      const firstItem = job.items[0] || {};
      const sheetSize = (firstItem.widthIn && firstItem.heightIn) 
        ? `${firstItem.widthIn}x${firstItem.heightIn}` 
        : "N/A";

      return {
        id: job.id,
        orderId: job.id,
        customer: `${job.customer.firstName} ${job.customer.lastName}`,
        sheetSize,
        orderDescription: firstItem.name || "N/A",
        status: job.status,
        deadline: job.createdAt.toISOString(),
        priority: job.priority
      };
    });

    res.json({ jobs: formattedJobs });
  } catch (error) {
    next(error);
  }
};

export const updateJobStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { status } = req.body;
    const printerId = req.user?.id;

    const allowedStatuses = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "COMPLETED"];
    if (!status || !allowedStatuses.includes(status)) {
      const error = new Error("Invalid status provided") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    job.status = status as any;
    if (!job.statusTimeline) job.statusTimeline = [];
    job.statusTimeline.push({ status: status as any, time: new Date() });
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

export const updateJobPriority = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { priority } = req.body;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (priority === "Urgent") {
      job.priority = "URGENT";
    } else if (priority === null) {
      job.priority = "NORMAL";
    } else {
      const error = new Error("Invalid priority value. Must be 'Urgent' or null.") as CustomError;
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

export const getJobDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
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
      timeline: (job.statusTimeline || []).map(t => ({
        status: t.status,
        time: t.time
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const getJobCustomerInfo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
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

export const updateJobNotes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { notes } = req.body;
    const printerId = req.user?.id;

    if (typeof notes !== "string") {
      const error = new Error("Notes must be a string") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (notes.length > 2000) {
      const error = new Error("Notes maximum length is 2000 characters") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
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

export const updateJobSpecs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { filmType, passes, temperatureC, pressSeconds } = req.body;
    const printerId = req.user?.id;

    const allowedFilmTypes = ["DTF", "UV", "Screen", "Sublimation"];
    if (filmType && !allowedFilmTypes.includes(filmType)) {
      const error = new Error("Invalid filmType. Must be one of: DTF | UV | Screen | Sublimation.") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!job.specs) {
      job.specs = {};
    }

    if (filmType !== undefined) job.specs.filmType = filmType;
    if (passes !== undefined) job.specs.passes = passes;
    if (temperatureC !== undefined) job.specs.temperatureC = temperatureC;
    if (pressSeconds !== undefined) job.specs.pressSeconds = pressSeconds;

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

export const executeJobAction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { action, reason } = req.body;
    const printerId = req.user?.id;

    const allowedActions = ["ACCEPT", "REJECT", "START", "PAUSE", "RESUME"];
    if (!action || !allowedActions.includes(action)) {
      const error = new Error("Invalid action. Must be one of: ACCEPT | REJECT | START | PAUSE | RESUME") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (action === "REJECT" && !reason) {
      const error = new Error("REJECT requires a reason field") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    let nextStatus: any;
    switch (action) {
      case "ACCEPT":
        if (job.status !== "PENDING") {
          const error = new Error(`Cannot ACCEPT job in ${job.status} state. ACCEPT transitions Pending -> Processing.`) as CustomError;
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PROCESSING";
        break;
      case "REJECT":
        if (job.status !== "PENDING") {
          const error = new Error(`Cannot REJECT job in ${job.status} state. REJECT transitions Pending -> Rejected.`) as CustomError;
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "REJECTED";
        job.rejectionReason = reason;
        break;
      case "START":
        if (job.status !== "PROCESSING") {
          const error = new Error(`Cannot START job in ${job.status} state. START transitions Processing -> Printing.`) as CustomError;
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PRINTING";
        break;
      case "PAUSE":
        if (job.status !== "PRINTING") {
          const error = new Error(`Cannot PAUSE job in ${job.status} state. PAUSE transitions Printing -> Paused.`) as CustomError;
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PAUSED";
        break;
      case "RESUME":
        if (job.status !== "PAUSED") {
          const error = new Error(`Cannot RESUME job in ${job.status} state. RESUME transitions Paused -> Printing.`) as CustomError;
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PRINTING";
        break;
    }

    job.status = nextStatus;
    if (!job.statusTimeline) job.statusTimeline = [];
    job.statusTimeline.push({ status: nextStatus as any, time: new Date() });
    await job.save();

    res.json({
      id: job.id,
      status: job.status
    });
  } catch (error) {
    next(error);
  }
};

export const getJobAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const designIds = job.items
      .filter(item => item.designId)
      .map(item => item.designId);

    const designs = await Design.find({ _id: { $in: designIds } });
    
    const assetIds = new Set<string>();
    designs.forEach(design => {
      if (design.artboardData && design.artboardData.items) {
        design.artboardData.items.forEach(item => {
          if (item.assetId) assetIds.add(item.assetId);
        });
      }
    });

    const assets = await Asset.find({ _id: { $in: Array.from(assetIds) } });

    const formattedAssets = assets.map(asset => ({
      id: asset.id,
      filename: asset.originalFilename,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      dpi: asset.dpi,
      downloadUrl: asset.url
    }));

    const totalBytes = assets.reduce((sum, asset) => sum + (asset.sizeBytes || 0), 0);

    res.json({
      assets: formattedAssets,
      counts: {
        images: assets.length,
        totalBytes
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createJobAssetBundle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { include } = req.body;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const designIds = job.items
      .filter(item => item.designId)
      .map(item => item.designId);

    const designs = await Design.find({ _id: { $in: designIds } });
    
    const allAssetIds = new Set<string>();
    designs.forEach(design => {
      if (design.artboardData && design.artboardData.items) {
        design.artboardData.items.forEach(item => {
          if (item.assetId) allAssetIds.add(item.assetId);
        });
      }
    });

    let targetAssetIds = Array.from(allAssetIds);

    if (Array.isArray(include)) {
      targetAssetIds = targetAssetIds.filter(id => include.includes(id));
      if (targetAssetIds.length === 0) {
        const error = new Error("None of the specified assets were found in this job") as CustomError;
        error.statusCode = 400;
        throw error;
      }
    } else if (include !== "ALL") {
      const error = new Error("Invalid 'include' value. Use 'ALL' or an array of asset IDs.") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const port = env.port || 4000;
    const bundleUrl = `http://localhost:${port}/uploads/bundle-${job.id}.zip`;

    res.status(201).json({
      bundleUrl
    });
  } catch (error) {
    next(error);
  }
};

export const exportJobGangsheet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { format } = req.body;
    const printerId = req.user?.id;

    const allowedFormats = ["PDF", "PNG", "TIFF"];
    if (!format || !allowedFormats.includes(format)) {
      const error = new Error("Invalid format. Must be one of: PDF | PNG | TIFF") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const port = env.port || 4000;
    const fileExtension = format.toLowerCase();
    const exportUrl = `http://localhost:${port}/uploads/gangsheet-${job.id}.${fileExtension}`;

    res.status(201).json({
      exportUrl,
      format
    });
  } catch (error) {
    next(error);
  }
};

export const getJobGangsheetPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const resolution = parseInt(req.query.resolution as string) || 150;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const port = env.port || 4000;
    const previewUrl = `http://localhost:${port}/uploads/preview-${job.id}-${resolution}.png`;

    res.json({
      previewUrl,
      resolutionDPI: resolution
    });
  } catch (error) {
    next(error);
  }
};

export const createJobShippingLabel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { size, carrier } = req.body;
    const printerId = req.user?.id;

    const allowedSizes = ["4x6", "4x4", "2x4"];
    if (!size || !allowedSizes.includes(size)) {
      const error = new Error("Invalid size. Must be one of: 4x6 | 4x4 | 2x4") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const mockTrackingNumber = `1Z${Math.random().toString(36).substring(2, 18).toUpperCase()}`;
    const port = env.port || 4000;
    const labelUrl = `http://localhost:${port}/uploads/label-${job.id}.pdf`;

    job.trackingNumber = mockTrackingNumber;
    job.carrier = carrier || "UPS";
    job.status = "SHIPPED" as any;
    if (!job.statusTimeline) job.statusTimeline = [];
    job.statusTimeline.push({ status: "SHIPPED" as any, time: new Date() });
    await job.save();

    res.status(201).json({
      labelUrl,
      trackingNumber: mockTrackingNumber
    });
  } catch (error) {
    next(error);
  }
};

export const updateJobTracking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { carrier, trackingNumber } = req.body;
    const printerId = req.user?.id;

    if (!carrier || !trackingNumber) {
      const error = new Error("Carrier and trackingNumber are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    job.carrier = carrier;
    job.trackingNumber = trackingNumber;
    
    if (!["SHIPPED", "COMPLETED"].includes(job.status)) {
      job.status = "SHIPPED" as any;
      if (!job.statusTimeline) job.statusTimeline = [];
      job.statusTimeline.push({ status: "SHIPPED" as any, time: new Date() });
    }

    await job.save();

    res.json({
      orderId: job.id,
      trackingNumber: job.trackingNumber,
      updatedAt: job.updatedAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const listPrinterOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { status } = req.query;

    const query: any = { assignedPrinter: printerId };

    const statusMap: { [key: string]: any } = {
      "Pending Review": "PENDING",
      "In Progress": "PROCESSING",
      "Ready": ["PRINTING", "QUALITY_CHECK"],
      "Completed": ["SHIPPED", "COMPLETED"]
    };

    if (status && statusMap[status as string]) {
      const backendStatus = statusMap[status as string];
      if (Array.isArray(backendStatus)) {
        query.status = { $in: backendStatus };
      } else {
        query.status = backendStatus;
      }
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });

    const formattedOrders = await Promise.all(orders.map(async (order) => {
      const firstItem = order.items[0] || {};
      const sheetSize = (firstItem.widthIn && firstItem.heightIn) 
        ? `${firstItem.widthIn}x${firstItem.heightIn}` 
        : "N/A";

      const location = order.shippingAddress 
        ? `${order.shippingAddress.city}, ${order.shippingAddress.state}`
        : "N/A";

            let displayStatus: any = order.status;
      for (const [label, val] of Object.entries(statusMap)) {
        if (Array.isArray(val) ? val.includes(order.status) : val === order.status) {
          displayStatus = label;
          break;
        }
      }

      const designIds = order.items.filter(i => i.designId).map(i => i.designId);
      const designs = await Design.find({ _id: { $in: designIds } });
      const assetIds = new Set<string>();
      designs.forEach(d => {
        d.artboardData?.items?.forEach(item => {
          if (item.assetId) assetIds.add(item.assetId);
        });
      });
      const assets = await Asset.find({ _id: { $in: Array.from(assetIds) } });
      
      const hasWarning = assets.length < assetIds.size || assets.some(a => !a.dpi || a.dpi < 150);

      return {
        id: order.id,
        customerName: `${order.customer.firstName} ${order.customer.lastName}`,
        sheetSize,
        location,
        status: displayStatus,
        dueDate: order.createdAt,
        isUrgent: order.priority === "URGENT",
        hasWarning
      };
    }));

    res.json({ orders: formattedOrders });
  } catch (error) {
    next(error);
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           

export const getOrderSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const printerId = req.user?.id;

    const order = await Order.findOne({ _id: orderId, assignedPrinter: printerId });

    if (!order) {
      const error = new Error("Order not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const statusMap: { [key: string]: any } = {
      "Pending Review": "PENDING",
      "In Progress": "PROCESSING",
      "Ready": ["PRINTING", "QUALITY_CHECK"],
      "Completed": ["SHIPPED", "COMPLETED"]
    };

        let displayStatus: any = order.status;
    for (const [label, val] of Object.entries(statusMap)) {
      if (Array.isArray(val) ? val.includes(order.status) : val === order.status) {
        displayStatus = label;
        break;
      }
    }

    res.json({
      id: order.id,
      status: displayStatus,
      items: order.items.length,
      amount: order.pricing?.total || 0,
      customer: `${order.customer.firstName} ${order.customer.lastName}`,
      createdAt: order.createdAt
    });
  } catch (error) {
    next(error);
  }
};

export const getEarningsSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { range = "30d" } = req.query;

    let startDate: Date;
    const now = new Date();
    if (range === "7d") {
      startDate = new Date(now.setDate(now.getDate() - 7));
    } else if (range === "all") {
      startDate = new Date(0);
    } else {
      startDate = new Date(now.setDate(now.getDate() - 30));
    }

    const orders = await Order.find({
      assignedPrinter: printerId,
      createdAt: { $gte: startDate }
    });

    let revenue = 0;
    let paidOut = 0;
    let pending = 0;

    const dailyRevenue: { [key: string]: number } = {};

    orders.forEach(order => {
      const amount = order.pricing?.total || 0;
      revenue += amount;

      if (["COMPLETED", "SHIPPED"].includes(order.status)) {
        paidOut += amount;
      } else {
        pending += amount;
      }

      const dateKey = order.createdAt.toISOString().split("T")[0];
      dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + amount;
    });

    const points: { date: string, revenue: number }[] = [];
    const dateRange = range === "all" ? 30 : (range === "7d" ? 7 : 30);
    
    const tempDate = new Date();
    for (let i = 0; i < dateRange; i++) {
      const d = new Date(tempDate);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      points.push({
        date: key,
        revenue: dailyRevenue[key] || 0
      });
    }
    points.reverse();

    res.json({
      totals: {
        revenue,
        paidOut,
        pending
      },
      trend: {
        period: range,
        points
      }
    });
  } catch (error) {
    next(error);
  }
};

export const listEarningsJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { status } = req.query;

    const query: any = { assignedPrinter: printerId };

    if (status) {
      if (status === "Paid") {
        query.status = { $in: ["SHIPPED", "COMPLETED"] };
      } else if (status === "Pending") {
        query.status = { $nin: ["SHIPPED", "COMPLETED", "CANCELLED", "REJECTED"] };
      }
    }

    const orders = await Order.find(query).sort({ updatedAt: -1 });

    const PLATFORM_RATE = 0.20;

    const jobs = orders.map(order => {
      const amount = order.pricing?.total || 0;
      const commission = amount * PLATFORM_RATE;
      const earning = amount - commission;
      const isPaid = ["SHIPPED", "COMPLETED"].includes(order.status);

      return {
        id: order.id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        amount: Number(amount.toFixed(2)),
        earning: Number(earning.toFixed(2)),
        commission: Number(commission.toFixed(2)),
        completed: order.updatedAt.toISOString().split("T")[0],
        status: isPaid ? "Paid" : "Pending"
      };
    });

    res.json({ jobs });
  } catch (error) {
    next(error);
  }
};

export const requestPayout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { amount, method } = req.body;

    const allowedMethods = ["bank_transfer", "paypal", "check"];
    if (!method || !allowedMethods.includes(method)) {
      const error = new Error("Invalid payout method. Must be: bank_transfer | paypal | check") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!amount || amount <= 0) {
      const error = new Error("Payout amount must be greater than zero") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const PLATFORM_RATE = 0.20;
    const orders = await Order.find({
      assignedPrinter: printerId,
      status: { $in: ["SHIPPED", "COMPLETED"] }
    });

    const totalAvailable = orders.reduce((sum, order) => {
      const orderAmount = order.pricing?.total || 0;
      const earning = orderAmount * (1 - PLATFORM_RATE);
      return sum + earning;
    }, 0);

    if (amount > totalAvailable) {
      const error = new Error(`Insufficient balance. Available pending earnings: $${totalAvailable.toFixed(2)}`) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const requestId = `payout_${Math.random().toString(36).substring(2, 9)}`;

    res.status(201).json({
      requestId,
      status: "Requested",
      amount: Number(amount.toFixed(2))
    });
  } catch (error) {
    next(error);
  }
};

export const confirmPayoutRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.params;

    res.json({
      requestId,
      status: "Confirmed",
      confirmedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const getPrinterEarnings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ message: "Printer earnings blueprint" });
  } catch (error) {
    next(error);
  }
};

export const getPrinterProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const user = await User.findById(printerId);                                                                                                  
                                   
    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.json({
      businessName: user.companyName || user.name,
      email: user.email,
      phone: user.phone || "N/A",
      website: user.website || "N/A",
      regions: user.regions || [],
      status: user.status || "Active"
    });
  } catch (error) {
    next(error);
  }
};

export const updatePrinterProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { businessName, phone, website } = req.body;

    const user = await User.findById(printerId);

    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (businessName) user.companyName = businessName;
    if (phone) user.phone = phone;
    if (website) user.website = website;

    await user.save();

    res.json({
      businessName: user.companyName || user.name,
      phone: user.phone || "N/A",
      website: user.website || "N/A"
    });
  } catch (error) {
    next(error);
  }
};

export const getPrinterSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const user = await User.findById(printerId);

    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const settings = user.settings || {};
    const paymentMethod = settings.paymentMethod || {};

    const accountMasked = paymentMethod.accountNumber 
      ? `****${paymentMethod.accountNumber.slice(-4)}`
      : (paymentMethod.paypalEmail || "N/A");

    const defaultHours = { isOpen: false, start: "9:00am", end: "6:00pm" };

    res.json({
      businessHours: settings.businessHours || { 
        monday: { ...defaultHours, isOpen: true }, 
        tuesday: { ...defaultHours, isOpen: true }, 
        wednesday: defaultHours, 
        thursday: defaultHours, 
        friday: defaultHours, 
        saturday: defaultHours, 
        sunday: defaultHours 
      },
      jobCapacity: settings.jobCapacity || { maxConcurrent: 5, dailyMax: 50, autoAccept: true },
      notifications: settings.notifications || { 
        email: {
          newJobs: true,
          jobUpdates: true,
          payoutAlerts: true,
          systemAlerts: true
        },
        sms: {
          urgentJobs: true,
          payoutComplete: false
        }
      },
      paymentMethod: {
        type: paymentMethod.type || "bank_transfer",
        accountMasked,
      },
      printingCapabilities: settings.printingCapabilities || {
        maxSheetSizeIn: { width: 24, height: 19.5 },
        supportedInks: ["CMYK", "White", "Neon", "Metallic"],
        supportedFilms: ["Hot Peel", "Cold Peel", "Super Cold Peel"],
        supportedFormats: ["PNG", "PDF", "TIFF"],
        maxResolutionDPI: 1200,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updatePrinterSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const updateData = req.body;

    const user = await User.findById(printerId);
    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!user.settings) user.settings = {} as any;

    const deepMerge = (target: any, source: any) => {
      for (const key in source) {
        if (source[key] instanceof Object && key in target) {
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };

    if (updateData.paymentMethod && updateData.paymentMethod.account) {
      const { routing, number } = updateData.paymentMethod.account;
      if (!user.settings.paymentMethod) user.settings.paymentMethod = {};
      if (routing) user.settings.paymentMethod.routingNumber = routing;
      if (number) user.settings.paymentMethod.accountNumber = number;
      delete updateData.paymentMethod.account;
    }

    deepMerge(user.settings, updateData);

    user.markModified("settings");
    await user.save();

    const settings = user.settings || {};
    const paymentMethod = settings.paymentMethod || {};
    const accountMasked = paymentMethod.accountNumber 
      ? `****${paymentMethod.accountNumber.slice(-4)}`
      : (paymentMethod.paypalEmail || "N/A");

    const defaultHours = { isOpen: false, start: "9:00am", end: "6:00pm" };

    res.json({
      businessHours: settings.businessHours || { 
        monday: { ...defaultHours, isOpen: true }, 
        tuesday: { ...defaultHours, isOpen: true }, 
        wednesday: defaultHours, 
        thursday: defaultHours, 
        friday: defaultHours, 
        saturday: defaultHours,  
        sunday: defaultHours 
      },
      jobCapacity: settings.jobCapacity || { maxConcurrent: 5, dailyMax: 50, autoAccept: true },
      notifications: settings.notifications || { 
        email: {
          newJobs: true,
          jobUpdates: true,
          payoutAlerts: true,
          systemAlerts: true
        },
        sms: {
          urgentJobs: true,
          payoutComplete: false
        }
      },
      paymentMethod: {
        type: paymentMethod.type || "bank_transfer",
        accountMasked,
      },
      printingCapabilities: settings.printingCapabilities || {
        maxSheetSizeIn: { width: 24, height: 19.5 },
        supportedInks: ["CMYK", "White", "Neon", "Metallic"],
        supportedFilms: ["Hot Peel", "Cold Peel", "Super Cold Peel"],
        supportedFormats: ["PNG", "PDF", "TIFF"],
        maxResolutionDPI: 1200,
      },
    });
  } catch (error) {
    next(error);
  }
}; 
