import { Order } from "../models/order.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
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

export const getJobAssets = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    // 1. Get all designIds from job items
    const designIds = job.items
      .filter(item => item.designId)
      .map(item => item.designId);

    // 2. Fetch Designs to get assetIds
    const designs = await Design.find({ _id: { $in: designIds } });
    
    // 3. Collect all unique assetIds from those designs
    const assetIds = new Set();
    designs.forEach(design => {
      if (design.artboardData && design.artboardData.items) {
        design.artboardData.items.forEach(item => {
          if (item.assetId) assetIds.add(item.assetId);
        });
      }
    });

    // 4. Fetch Assets
    const assets = await Asset.find({ _id: { $in: Array.from(assetIds) } });

    // 5. Format assets with "signed" URLs (mocking signing logic for now)
    // In a real scenario, this would involve a service like AWS S3 getSignedUrl
    const formattedAssets = assets.map(asset => ({
      id: asset.id,
      filename: asset.originalFilename,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      dpi: asset.dpi,
      downloadUrl: asset.url // In production, this would be a signed URL
    }));

    // 6. Calculate stats
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

export const createJobAssetBundle = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { include } = req.body;
    const printerId = req.user.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    // 1. Get all designIds from job items
    const designIds = job.items
      .filter(item => item.designId)
      .map(item => item.designId);

    // 2. Fetch Designs to get assetIds
    const designs = await Design.find({ _id: { $in: designIds } });
    
    // 3. Collect all unique assetIds from those designs
    const allAssetIds = new Set();
    designs.forEach(design => {
      if (design.artboardData && design.artboardData.items) {
        design.artboardData.items.forEach(item => {
          if (item.assetId) allAssetIds.add(item.assetId);
        });
      }
    });

    let targetAssetIds = Array.from(allAssetIds);

    // 4. Filter if include is a list
    if (Array.isArray(include)) {
      targetAssetIds = targetAssetIds.filter(id => include.includes(id));
      if (targetAssetIds.length === 0) {
        const error = new Error("None of the specified assets were found in this job");
        error.statusCode = 400;
        throw error;
      }
    } else if (include !== "ALL") {
      const error = new Error("Invalid 'include' value. Use 'ALL' or an array of asset IDs.");
      error.statusCode = 400;
      throw error;
    }

    // 5. Mock ZIP generation
    // In a real application, this would:
    // a. Create a ZIP of the files from S3/Storage
    // b. Upload the ZIP to a temporary location
    // c. Return a signed URL
    const port = env.port || 4000;
    const bundleUrl = `http://localhost:${port}/uploads/bundle-${job.id}.zip`;

    // Simulate async generation (optional, since the requirement says it may take 30s)
    // For this mock, we just return the URL immediately.

    res.status(201).json({
      bundleUrl
    });
  } catch (error) {
    next(error);
  }
};

export const exportJobGangsheet = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { format, resolutionDPI, settings } = req.body;
    const printerId = req.user.id;

    const allowedFormats = ["PDF", "PNG", "TIFF"];
    if (!format || !allowedFormats.includes(format)) {
      const error = new Error("Invalid format. Must be one of: PDF | PNG | TIFF");
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    // Mock gangsheet generation
    // In a real application, this would:
    // a. Render the designs according to the job's layout
    // b. Apply pre-press settings (crop marks, color bars, ICC profiles)
    // c. Save the file to storage (e.g., S3)
    // d. Generate a signed URL valid for production access
    const port = env.port || 4000;
    const fileExtension = format.toLowerCase();
    const exportUrl = `http://localhost:${port}/uploads/gangsheet-${job.id}.${fileExtension}`;

    // Return the response immediately (generation is mocked as async)
    res.status(201).json({
      exportUrl,
      format
    });
  } catch (error) {
    next(error);
  }
};

export const getJobGangsheetPreview = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const resolution = parseInt(req.query.resolution) || 150;
    const printerId = req.user.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    // Mock preview generation
    // In a real application, this would:
    // a. Render a low-res version of the gangsheet
    // b. Cache the preview for 6 hours
    // c. Return a signed URL
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

export const createJobShippingLabel = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { size, carrier, service } = req.body;
    const printerId = req.user.id;

    const allowedSizes = ["4x6", "4x4", "2x4"];
    if (!size || !allowedSizes.includes(size)) {
      const error = new Error("Invalid size. Must be one of: 4x6 | 4x4 | 2x4");
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    // Mock shipping label generation
    // In a real application, this would:
    // a. Call a shipping API (like ShipStation, EasyPost, or direct carrier APIs)
    // b. Generate a PDF label
    // c. Save tracking info to the order
    const mockTrackingNumber = `1Z${Math.random().toString(36).substring(2, 18).toUpperCase()}`;
    const port = env.port || 4000;
    const labelUrl = `http://localhost:${port}/uploads/label-${job.id}.pdf`;

    // Update order with tracking information
    job.trackingNumber = mockTrackingNumber;
    job.carrier = carrier || "UPS";
    job.status = "SHIPPED";
    job.statusTimeline.push({ status: "SHIPPED", time: new Date() });
    await job.save();

    res.status(201).json({
      labelUrl,
      trackingNumber: mockTrackingNumber
    });
  } catch (error) {
    next(error);
  }
};

export const updateJobTracking = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { carrier, trackingNumber, trackingUrl } = req.body;
    const printerId = req.user.id;

    if (!carrier || !trackingNumber) {
      const error = new Error("Carrier and trackingNumber are required");
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    job.carrier = carrier;
    job.trackingNumber = trackingNumber;
    // Note: If the Order model needs to store trackingUrl explicitly, it should be added to the schema.
    // For now, we update carrier and trackingNumber which are already in the schema.
    
    // If the status isn't already SHIPPED or COMPLETED, we might want to update it to SHIPPED
    if (!["SHIPPED", "COMPLETED"].includes(job.status)) {
      job.status = "SHIPPED";
      job.statusTimeline.push({ status: "SHIPPED", time: new Date() });
    }

    await job.save();

    res.json({
      orderId: job.id, // Or job.orderId if you have a separate human-readable ID
      trackingNumber: job.trackingNumber,
      updatedAt: job.updatedAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const listPrinterOrders = async (req, res, next) => {
  try {
    const printerId = req.user.id;
    const { status } = req.query;

    const query = { assignedPrinter: printerId };

    // Map frontend statuses to backend statuses
    const statusMap = {
      "Pending Review": "PENDING",
      "In Progress": "PROCESSING",
      "Ready": ["PRINTING", "QUALITY_CHECK"],
      "Completed": ["SHIPPED", "COMPLETED"]
    };

    if (status && statusMap[status]) {
      const backendStatus = statusMap[status];
      if (Array.isArray(backendStatus)) {
        query.status = { $in: backendStatus };
      } else {
        query.status = backendStatus;
      }
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });

    const formattedOrders = await Promise.all(orders.map(async (order) => {
      // 1. Determine sheetSize (from first item)
      const firstItem = order.items[0] || {};
      const sheetSize = (firstItem.widthIn && firstItem.heightIn) 
        ? `${firstItem.widthIn}x${firstItem.heightIn}` 
        : "N/A";

      // 2. Determine location
      const location = order.shippingAddress 
        ? `${order.shippingAddress.city}, ${order.shippingAddress.state}`
        : "N/A";

      // 3. Map backend status back to frontend label
      let displayStatus = order.status;
      for (const [label, val] of Object.entries(statusMap)) {
        if (Array.isArray(val) ? val.includes(order.status) : val === order.status) {
          displayStatus = label;
          break;
        }
      }

      // 4. Asset Integrity Check (hasWarning)
      // hasWarning is true if any linked asset fails the integrity check (below 150 DPI or missing)
      const designIds = order.items.filter(i => i.designId).map(i => i.designId);
      const designs = await Design.find({ _id: { $in: designIds } });
      const assetIds = new Set();
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
        dueDate: order.createdAt, // Using createdAt as a base for dueDate
        isUrgent: order.priority === "URGENT",
        hasWarning
      };
    }));

    res.json({ orders: formattedOrders });
  } catch (error) {
    next(error);
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           

export const getOrderSummary = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const printerId = req.user.id;

    const order = await Order.findOne({ _id: orderId, assignedPrinter: printerId });

    if (!order) {
      const error = new Error("Order not found or not assigned to this printer");
      error.statusCode = 404;
      throw error;
    }

    // Map backend status to frontend label (matching listPrinterOrders logic)
    const statusMap = {
      "Pending Review": "PENDING",
      "In Progress": "PROCESSING",
      "Ready": ["PRINTING", "QUALITY_CHECK"],
      "Completed": ["SHIPPED", "COMPLETED"]
    };

    let displayStatus = order.status;
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

export const getEarningsSummary = async (req, res, next) => {
  try {
    const printerId = req.user.id;
    const { range = "30d" } = req.query;

    let startDate;
    const now = new Date();
    if (range === "7d") {
      startDate = new Date(now.setDate(now.getDate() - 7));
    } else if (range === "all") {
      startDate = new Date(0); // All time
    } else {
      // Default 30d
      startDate = new Date(now.setDate(now.getDate() - 30));
    }

    const orders = await Order.find({
      assignedPrinter: printerId,
      createdAt: { $gte: startDate }
    });

    // Calculate totals
    let revenue = 0;
    let paidOut = 0;
    let pending = 0;

    const dailyRevenue = {};

    orders.forEach(order => {
      const amount = order.pricing?.total || 0;
      revenue += amount;

      if (["COMPLETED", "SHIPPED"].includes(order.status)) {
        paidOut += amount;
      } else {
        pending += amount;
      }

      // Prepare daily revenue for trend
      const dateKey = order.createdAt.toISOString().split("T")[0];
      dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + amount;
    });

    // Format trend points
    const points = [];
    const dateRange = range === "all" ? 30 : (range === "7d" ? 7 : 30); // Use 30 for 'all' as a fallback for trend visualization
    
    // In a real app, we would iterate through every day in the range to ensure zero values are represented
    // For this mock/blueprint implementation, we'll just return the days that have data or a simple loop
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

export const listEarningsJobs = async (req, res, next) => {
  try {
    const printerId = req.user.id;
    const { status } = req.query;

    const query = { assignedPrinter: printerId };

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
        id: order.id, // Or a custom job ID format if available
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

export const getPrinterEarnings = async (req, res, next) => {
  try {
    res.json({ message: "Printer earnings blueprint" });
  } catch (error) {
    next(error);
  }
};
