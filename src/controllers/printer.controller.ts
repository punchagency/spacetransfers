import { Request, Response, NextFunction } from "express";
import { Order } from "../models/order.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
import { User } from "../models/user.model.js";
import { Settings } from "../models/settings.model.js";
import archiver from "archiver";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import fs from "fs";
import path from "path";
import { Readable } from "node:stream";
import { GangsheetExport } from "../models/gangsheetExport.model.js";
import { GangsheetExportAudit } from "../models/gangsheetExportAudit.model.js";
import { exportGangsheetPng24 } from "../services/gangsheetExport.service.js";
import { uploadPngToDrive } from "../services/googleDrive.service.js";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";

interface CustomError extends Error {
  statusCode?: number;
}

const isObjectIdString = (v: string) => /^[0-9a-fA-F]{24}$/.test(v);
const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
const resolveLocalUploadPath = (url: string) => {
  const marker = "/uploads/";
  const idx = String(url || "").lastIndexOf(marker);
  if (idx === -1) return null;
  const filename = String(url).substring(idx + marker.length);
  const safeFilename = path.basename(filename);
  return path.join(process.cwd(), "uploads", safeFilename);
};

const splitAssetRefs = (refs: Set<string>) => {
  const ids: mongoose.Types.ObjectId[] = [];
  const urls: string[] = [];
  for (const r of refs) {
    const s = String(r || "");
    if (!s) continue;
    if (isObjectIdString(s)) ids.push(new mongoose.Types.ObjectId(s));
    else urls.push(s);
  }
  return { ids, urls };
};

const pickMostPopulatedItem = (items: any[]) => {
  const list = Array.isArray(items) ? items : [];
  let best: any | null = null;
  let bestCopies = -1;
  let bestArea = -1;
  let bestIndex = Number.POSITIVE_INFINITY;

  for (let i = 0; i < list.length; i += 1) {
    const it = list[i];
    if (!it) continue;
    const copies = typeof it.copies === "number" && Number.isFinite(it.copies) ? Math.max(0, it.copies) : 0;
    const w = typeof it.widthIn === "number" && Number.isFinite(it.widthIn) ? Math.max(0, it.widthIn) : 0;
    const h = typeof it.heightIn === "number" && Number.isFinite(it.heightIn) ? Math.max(0, it.heightIn) : 0;
    const area = w * h;

    const isBetter =
      copies > bestCopies ||
      (copies === bestCopies && area > bestArea) ||
      (copies === bestCopies && area === bestArea && i < bestIndex);

    if (isBetter) {
      best = it;
      bestCopies = copies;
      bestArea = area;
      bestIndex = i;
    }
  }

  return best;
};

const resolveThumbnailUrl = (ref: string, assetsById: Map<string, string>) => {
  const s = String(ref || "").trim();
  if (!s) return null;
  if (!isObjectIdString(s)) return s;
  const fromMap = assetsById.get(s);
  return fromMap || null;
};

const computeGangsheetFaceThumbnail = ({
  items,
  assetsById,
}: {
  items: any[];
  assetsById: Map<string, string>;
}) => {
  const gangsheetItem = (Array.isArray(items) ? items : []).find((i: any) => i?.type === "gangsheet") || (items || [])[0] || {};
  const artboardItems = Array.isArray((gangsheetItem as any).artboardItems) ? (gangsheetItem as any).artboardItems : [];
  const best = pickMostPopulatedItem(artboardItems);
  if (!best) return null;

  const croppedUrl = typeof best.croppedUrl === "string" ? best.croppedUrl.trim() : "";
  if (croppedUrl) return croppedUrl;

  return resolveThumbnailUrl(String(best.assetId || ""), assetsById);
};

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const printer = printerId ? await User.findById(printerId).select("settings.pricing").lean() : null;
    const partnerPricing = (printer as any)?.settings?.pricing || {};
    const basePriceForOrder = (order: any) =>
      computePartnerCostBreakdown({
        items: Array.isArray(order?.items) ? order.items : [],
        partnerPricing,
        priority: order?.priority,
        adjustments: Array.isArray(order?.pricing?.adjustments) ? order.pricing.adjustments : [],
      }).subtotal;

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
    })
      .select("displayId status updatedAt createdAt items pricing.adjustments priority customer")
      .lean();

    const todayCompleted = printerOrders.filter(o => o.status === "COMPLETED" && o.updatedAt >= todayStart);
    const todayEarnings = todayCompleted.reduce((sum, o) => sum + basePriceForOrder(o), 0);

    const yesterdayCompleted = printerOrders.filter(o => o.status === "COMPLETED" && o.updatedAt >= yesterdayStart && o.updatedAt <= yesterdayEnd);
    const yesterdayEarnings = yesterdayCompleted.reduce((sum, o) => sum + basePriceForOrder(o), 0);

    const completedTodayCount = todayCompleted.length;
    const completedYesterdayCount = yesterdayCompleted.length;

    const totalPendingCount = await Order.countDocuments({ assignedPrinter: printerId, status: "PENDING" });
    const yesterdayPendingCount = await Order.countDocuments({ 
      assignedPrinter: printerId, 
      status: "PENDING",
      createdAt: { $lt: todayStart }
    });

    const [completedOrdersAll, completedOrdersBeforeToday] = await Promise.all([
      Order.find({
        assignedPrinter: printerId,
        status: "COMPLETED",
      })
        .select("items pricing.adjustments priority")
        .lean(),
      Order.find({
        assignedPrinter: printerId,
        status: "COMPLETED",
        updatedAt: { $lt: todayStart },
      })
        .select("items pricing.adjustments priority")
        .lean(),
    ]);

    const totalRevenue = completedOrdersAll.reduce((sum, o) => sum + basePriceForOrder(o), 0);
    const totalRevenueBeforeToday = completedOrdersBeforeToday.reduce((sum, o) => sum + basePriceForOrder(o), 0);

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

    const activeAssignedJobs = await Order.find({
      assignedPrinter: printerId,
      status: { $in: ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"] }
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(12)
      .lean();

    const mapStatus = (s: string) => {
      const v = String(s || "").toUpperCase();
      if (v === "PENDING") return "Pending";
      if (v === "PROCESSING") return "Processing";
      if (v === "PRINTING") return "Printing";
      if (v === "QUALITY_CHECK") return "Quality Check";
      if (v === "COMPLETED") return "Completed";
      if (v === "CANCELLED") return "Cancelled";
      return "Pending";
    };

    const assignedJobs = activeAssignedJobs.map((job: any) => ({
      id: String(job._id),
      displayId: job?.displayId ? String(job.displayId) : null,
      customerName: `${job.customer?.firstName || ""} ${job.customer?.lastName || ""}`.trim(),
      order: `${Array.isArray(job.items) ? job.items.length : 0} Items`,
      deadline: job.createdAt
        ? new Date(job.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", 2:00 PM"
        : "—",
      status: mapStatus(String(job.status || "")),
      isUrgent: String(job.priority || "").toUpperCase() === "URGENT",
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null
    }));

    const urgentJobs = await Order.find({ 
      assignedPrinter: printerId,
      priority: "URGENT",
      status: { $in: ["PENDING", "PROCESSING"] }
    }).select("displayId customer items createdAt priority status").sort({ createdAt: 1 }).limit(5);

    const formattedUrgentJobs = urgentJobs.map(job => ({
      id: job.id,
      displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
      customerName: `${job.customer.firstName} ${job.customer.lastName}`,
      order: `${job.items.length} Items`,
      deadline: job.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", 2:00 PM",
      status: "Urgent",
      isUrgent: true,
      createdAt: job.createdAt.toISOString()
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
      urgentJobs: formattedUrgentJobs,
      assignedJobs
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
    } else {
      query.status = { $in: ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"] };
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
        orderId: (job as any)?.displayId ? String((job as any).displayId) : job.id,
        displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
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
      orderId: (job as any)?.displayId ? String((job as any).displayId) : job.id,
      displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
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

    const assetIds = new Set<string>();

    for (const item of job.items) {
      // Only items in the gangsheet should be shown
      if (item.type === "gangsheet" || item.artboardItems) {
        if (Array.isArray(item.artboardItems) && item.artboardItems.length > 0) {
          item.artboardItems.forEach((ai: any) => {
            if (ai.assetId) assetIds.add(String(ai.assetId));
          });
        } else if (item.designId && isObjectIdString(String(item.designId))) {
          // Fallback to design if artboardItems not snapshotted in order
          const design = await Design.findById(item.designId).select("artboardData").lean();
          if (design?.artboardData?.items) {
            design.artboardData.items.forEach((di: any) => {
              if (di.assetId) assetIds.add(String(di.assetId));
            });
          }
        }
      }
    }

    const { ids, urls } = splitAssetRefs(assetIds);
    const assets = await Asset.find({
      $or: [
        ...(ids.length ? [{ _id: { $in: ids } }] : []),
        ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : [])
      ]
    });

    const uniqueAssetsMap = new Map<string, any>();
    assets.forEach(asset => {
      // Deduplicate by original URL to ensure "clean copy" and "prevent duplicate copies"
      const url = asset.url;
      if (url && !uniqueAssetsMap.has(url)) {
        uniqueAssetsMap.set(url, {
          id: asset.id,
          filename: asset.originalFilename,
          widthPx: asset.widthPx,
          heightPx: asset.heightPx,
          dpi: asset.dpi,
          downloadUrl: asset.url,
          sizeBytes: asset.sizeBytes || 0
        });
      }
    });

    const formattedAssets = Array.from(uniqueAssetsMap.values());
    const totalBytes = formattedAssets.reduce((sum, asset) => sum + (asset.sizeBytes || 0), 0);

    res.json({
      assets: formattedAssets,
      counts: {
        images: formattedAssets.length,
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

    const allAssetIds = new Set<string>();

    for (const item of job.items) {
      // Only items in the gangsheet should be shown
      if (item.type === "gangsheet" || item.artboardItems) {
        if (Array.isArray(item.artboardItems) && item.artboardItems.length > 0) {
          item.artboardItems.forEach((ai: any) => {
            if (ai.assetId) allAssetIds.add(String(ai.assetId));
          });
        } else if (item.designId && isObjectIdString(String(item.designId))) {
          // Fallback to design if artboardItems not snapshotted in order
          const design = await Design.findById(item.designId).select("artboardData").lean();
          if (design?.artboardData?.items) {
            design.artboardData.items.forEach((di: any) => {
              if (di.assetId) allAssetIds.add(String(di.assetId));
            });
          }
        }
      }
    }

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

    res.status(201).json({
      bundleDownloadUrl: `http://localhost:${env.port || 4000}/api/printer/jobs/${encodeURIComponent(String(job.id))}/assets/bundle/download${
        include === "ALL"
          ? `?include=ALL`
          : Array.isArray(include)
            ? `?include=${encodeURIComponent(include.map((v: any) => String(v)).join(","))}`
            : ""
      }`
    });
  } catch (error) {
    next(error);
  }
};

export const downloadJobAssetBundle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const includeParam = Array.isArray(req.query.include) ? String(req.query.include[0] || "") : String(req.query.include || "ALL");
    const includeAll = !includeParam || includeParam === "ALL";
    const requestedIds = includeAll
      ? null
      : includeParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    const allAssetIds = new Set<string>();

    for (const item of job.items) {
      // Only items in the gangsheet should be shown
      if (item.type === "gangsheet" || item.artboardItems) {
        if (Array.isArray(item.artboardItems) && item.artboardItems.length > 0) {
          item.artboardItems.forEach((ai: any) => {
            if (ai.assetId) allAssetIds.add(String(ai.assetId));
          });
        } else if (item.designId && isObjectIdString(String(item.designId))) {
          // Fallback to design if artboardItems not snapshotted in order
          const design = await Design.findById(item.designId).select("artboardData").lean();
          if (design?.artboardData?.items) {
            design.artboardData.items.forEach((di: any) => {
              if (di.assetId) allAssetIds.add(String(di.assetId));
            });
          }
        }
      }
    }

    // Include additional logic to normalize asset IDs for filtering
    const { ids: jobAssetIds, urls: jobAssetUrls } = splitAssetRefs(allAssetIds);
    const jobAssetIdStrings = new Set([
      ...jobAssetIds.map(id => id.toString()),
      ...jobAssetUrls
    ]);

    let targetAssetIds = Array.from(allAssetIds);
    if (requestedIds) {
      // Ensure we compare requested IDs against the normalized job asset IDs
      targetAssetIds = requestedIds.filter((id) => jobAssetIdStrings.has(id));
      if (targetAssetIds.length === 0) {
        const error = new Error("None of the specified assets were found in this job") as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    const { ids, urls } = splitAssetRefs(new Set(targetAssetIds));
    const assets =
      ids.length || urls.length
        ? await Asset.find({
            $or: [
              ...(ids.length ? [{ _id: { $in: ids } }] : []),
              ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : [])
            ]
          }).lean()
        : [];

    if (assets.length === 0) {
      const error = new Error("No assets available for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    const zipName = `original_assets_${String(job.id).slice(-6).toUpperCase()}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 0 } });
    archive.on("error", (err: any) => {
      next(err);
    });
    archive.pipe(res);

    const addedFiles = new Set<string>();
    const usedNames = new Set<string>();
    const skippedFiles: string[] = [];
    let addedCount = 0;

    for (const a of assets as any[]) {
      // Prioritize the original URL for "Download Original" functionality
      const url = String(a?.url || a?.trimmedUrl || "");
      if (!url) continue;

      // Prevent duplicate files in the same bundle - "ensure users receive a single, clean copy"
      if (addedFiles.has(url)) continue;
      addedFiles.add(url);

      const preferredName = String(a?.originalFilename || "").trim();
      const fallbackName = path.basename(url.split("?")[0] || "") || `asset_${String(a?._id || "")}.bin`;
      let entryName = preferredName || fallbackName;

      // Handle name collisions in the zip
      if (usedNames.has(entryName)) {
        const ext = path.extname(entryName);
        const base = path.basename(entryName, ext);
        let counter = 1;
        while (usedNames.has(`${base}_${counter}${ext}`)) {
          counter++;
        }
        entryName = `${base}_${counter}${ext}`;
      }
      usedNames.add(entryName);

      const localPath = resolveLocalUploadPath(url);

      try {
        // Direct reference to source file - "verify download mechanism correctly references gansheet source"
        if (localPath && fs.existsSync(localPath)) {
          const stats = fs.statSync(localPath);
          if (stats.size > 0) {
            archive.file(localPath, { name: entryName });
            addedCount++;
            continue;
          } else {
            console.warn(`Asset file is empty: ${localPath}`);
            skippedFiles.push(`${entryName} (Empty file)`);
            continue;
          }
        }

        // Fallback to remote fetch if not local, still streaming - "eliminate redundant file generation"
        if (/^https?:\/\//i.test(url)) {
          const r = await fetch(url);
          if (r.ok) {
            const contentLength = r.headers.get("content-length");
            if (contentLength === "0") {
              skippedFiles.push(`${entryName} (Remote file is empty)`);
              continue;
            }
            const body = r.body ? Readable.fromWeb(r.body as any) : null;
            if (body) {
              archive.append(body, { name: entryName });
              addedCount++;
            } else {
              skippedFiles.push(`${entryName} (Failed to read remote body)`);
            }
          } else {
            skippedFiles.push(`${entryName} (Remote fetch failed: ${r.status})`);
          }
        } else {
          skippedFiles.push(`${entryName} (Invalid source URL)`);
        }
      } catch (err) {
        console.error(`Error adding asset ${a._id} to bundle:`, err);
        skippedFiles.push(`${entryName} (Internal error)`);
      }
    }

    if (skippedFiles.length > 0) {
      const errorLog = `The following files could not be included in this bundle:\n\n${skippedFiles.join("\n")}`;
      archive.append(errorLog, { name: "DOWNLOAD_ERRORS.txt" });
    }

    await archive.finalize();
  } catch (error) {
    next(error);
  }
};

export const exportJobGangsheet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { format, toDrive } = req.body || {};
    const printerId = req.user?.id;

    if (!format || String(format).toUpperCase() !== "PNG") {
      const error = new Error("Invalid format. Must be PNG") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const gangsheetItem = (job.items || []).find((i: any) => i?.type === "gangsheet") || (job.items || [])[0] || {};
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    const rendered = await exportGangsheetPng24({
      jobId: job.id,
      printerId: String(printerId),
      sheetWidthIn: gangsheetItem.sheetWidthIn ?? gangsheetItem.widthIn,
      sheetHeightIn: gangsheetItem.sheetHeightIn ?? gangsheetItem.heightIn,
      artboardItems,
      dpi: 600,
      cropToContent: true
    });

    if (!rendered.validation.ok) {
      const error = new Error(`Export validation failed: ${rendered.validation.errors.join(", ")}`) as CustomError;
      error.statusCode = 422;
      throw error;
    }

    const exportDoc = await GangsheetExport.create({
      jobId: new mongoose.Types.ObjectId(job.id),
      printerId: new mongoose.Types.ObjectId(String(printerId)),
      format: "png",
      dpi: rendered.dpi,
      sheet: rendered.sheet,
      fileName: rendered.fileName,
      filePath: rendered.filePath,
      byteSize: rendered.byteSize,
      validation: rendered.validation,
      drive: { status: "skipped" }
    });

    await GangsheetExportAudit.create({
      exportId: exportDoc._id,
      jobId: exportDoc.jobId,
      printerId: exportDoc.printerId,
      action: "export_created",
      meta: { format: "png", dpi: rendered.dpi }
    });

    let driveResult: any = null;
    if (Boolean(toDrive)) {
      const uploaded = await uploadPngToDrive({ localFilePath: rendered.filePath, fileName: rendered.fileName });
      if (uploaded.uploaded) {
        await GangsheetExport.updateOne(
          { _id: exportDoc._id },
          { $set: { drive: { status: "uploaded", fileId: uploaded.fileId, webViewLink: uploaded.webViewLink, uploadedAt: new Date() } } }
        );
        await GangsheetExportAudit.create({
          exportId: exportDoc._id,
          jobId: exportDoc.jobId,
          printerId: exportDoc.printerId,
          action: "drive_uploaded",
          meta: { fileId: uploaded.fileId, webViewLink: uploaded.webViewLink }
        });
      } else {
        await GangsheetExport.updateOne(
          { _id: exportDoc._id },
          { $set: { drive: { status: "failed", error: uploaded.error || "drive_failed" } } }
        );
        await GangsheetExportAudit.create({
          exportId: exportDoc._id,
          jobId: exportDoc.jobId,
          printerId: exportDoc.printerId,
          action: "drive_failed",
          meta: { error: uploaded.error || "drive_failed" }
        });
      }
      driveResult = uploaded;
    }

    res.status(201).json({
      exportId: String(exportDoc._id),
      format: "PNG",
      dpi: rendered.dpi,
      sheet: rendered.sheet,
      validation: rendered.validation,
      drive: driveResult
        ? { uploaded: Boolean(driveResult.uploaded), fileId: driveResult.fileId, webViewLink: driveResult.webViewLink, error: driveResult.error }
        : null
    });
  } catch (error) {
    next(error);
  }
};

export const getJobGangsheetPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const resolution = Math.max(72, Math.min(300, parseInt(req.query.resolution as string) || 150));
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const gangsheetItem = (job.items || []).find((i: any) => i?.type === "gangsheet") || (job.items || [])[0] || {};
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    const sheetWidthInRaw = gangsheetItem.sheetWidthIn ?? gangsheetItem.widthIn;
    const sheetHeightInRaw = gangsheetItem.sheetHeightIn ?? gangsheetItem.heightIn;
    const sheetWidthIn = typeof sheetWidthInRaw === "number" && Number.isFinite(sheetWidthInRaw) ? sheetWidthInRaw : 23.5;
    const sheetHeightIn = typeof sheetHeightInRaw === "number" && Number.isFinite(sheetHeightInRaw) ? sheetHeightInRaw : 23.5;

    const rendered = await exportGangsheetPng24({
      jobId: job.id,
      printerId: String(printerId),
      sheetWidthIn,
      sheetHeightIn,
      artboardItems,
      dpi: resolution
    });

    const fileBuf = await fs.promises.readFile(rendered.filePath);
    const b64 = fileBuf.toString("base64");

    res.json({
      previewDataUrl: `data:image/png;base64,${b64}`,
      resolutionDPI: rendered.dpi,
      sheetWidthIn,
      sheetHeightIn
    });
  } catch (error) {
    next(error);
  }
};

export const downloadGangsheetExport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { exportId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(exportId) ? String(exportId[0] || "") : String(exportId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid export id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const exp = await GangsheetExport.findOne({ _id: new mongoose.Types.ObjectId(id), printerId: new mongoose.Types.ObjectId(String(printerId)) }).lean();
    if (!exp) {
      const error = new Error("Export not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!fs.existsSync(String((exp as any).filePath))) {
      const error = new Error("Export file missing") as CustomError;
      error.statusCode = 410;
      throw error;
    }

    await GangsheetExportAudit.create({
      exportId: (exp as any)._id,
      jobId: (exp as any).jobId,
      printerId: (exp as any).printerId,
      action: "downloaded",
      meta: { userAgent: String(req.headers["user-agent"] || ""), ip: String(req.ip || "") }
    });

    const stats = await fs.promises.stat(String((exp as any).filePath));
    res.setHeader("Content-Length", String(stats.size));
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="${String((exp as any).fileName)}"`);
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(String((exp as any).filePath)).pipe(res);
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
    const { status, q, limit = "30", cursor } = req.query;

    const query: any = { assignedPrinter: printerId };

    const statusMap: { [key: string]: any } = {
      "Pending Review": "PENDING",
      "In Progress": ["PROCESSING", "PRINTING"],
      "Ready": ["QUALITY_CHECK"],
      "Completed": ["SHIPPED", "COMPLETED"],
      "Cancelled": ["CANCELLED"]
    };

    if (status && statusMap[status as string]) {
      const backendStatus = statusMap[status as string];
      if (Array.isArray(backendStatus)) {
        query.status = { $in: backendStatus };
      } else {
        query.status = backendStatus;
      }
    }

    if (typeof q === "string" && q.trim()) {
      const raw = q.trim();
      const re = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { "customer.firstName": re },
        { "customer.lastName": re },
        { "customer.email": re },
        { "shippingAddress.city": re },
        { "shippingAddress.state": re },
        { displayId: re }
      ];
      if (mongoose.Types.ObjectId.isValid(raw)) {
        query.$or.push({ _id: new mongoose.Types.ObjectId(raw) });
      }
    }

    const pageSize = Math.max(1, Math.min(100, parseInt(String(limit), 10) || 30));
    if (typeof cursor === "string" && cursor.includes("_")) {
      const [createdAtMsRaw, idRaw] = cursor.split("_");
      const createdAtMs = Number(createdAtMsRaw);
      if (Number.isFinite(createdAtMs) && mongoose.Types.ObjectId.isValid(idRaw)) {
        query.$and = [
          ...(query.$and || []),
          {
            $or: [
              { createdAt: { $lt: new Date(createdAtMs) } },
              { createdAt: new Date(createdAtMs), _id: { $lt: new mongoose.Types.ObjectId(idRaw) } }
            ]
          }
        ];
      }
    }

    const orders = await Order.find(query).sort({ createdAt: -1, _id: -1 }).limit(pageSize + 1);

    const formatDueDate = (d: Date) => {
      const now = new Date();
      const startToday = new Date(now);
      startToday.setHours(0, 0, 0, 0);
      const startTomorrow = new Date(startToday);
      startTomorrow.setDate(startTomorrow.getDate() + 1);
      const startDayAfter = new Date(startToday);
      startDayAfter.setDate(startDayAfter.getDate() + 2);

      if (d >= startToday && d < startTomorrow) return "Due Today";
      if (d >= startTomorrow && d < startDayAfter) return "Due Tomorrow";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const statusDescription = (label: string) => {
      if (label === "Pending Review") return "Review artwork and accept this job";
      if (label === "In Progress") return "Currently being processed";
      if (label === "Ready") return "Ready for packaging and shipment";
      if (label === "Completed") return "Job completed successfully";
      return "";
    };

    const hasNextPage = orders.length > pageSize;
    const pageOrders = hasNextPage ? orders.slice(0, pageSize) : orders;

    const formattedOrders = await Promise.all(pageOrders.map(async (order) => {
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

      const designIdsRaw = order.items.filter(i => i.designId).map(i => String(i.designId));
      const designIds = designIdsRaw
        .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      const designs = designIds.length ? await Design.find({ _id: { $in: designIds } }) : [];
      const assetIds = new Set<string>();
      const gangsheetItem = (order.items || []).find((i: any) => i?.type === "gangsheet") || (order.items || [])[0] || {};
      const artboardItems = Array.isArray((gangsheetItem as any).artboardItems) ? (gangsheetItem as any).artboardItems : [];
      designs.forEach(d => {
        d.artboardData?.items?.forEach(item => {
          if (item.assetId) assetIds.add(item.assetId);
        });
      });
      artboardItems.forEach((it: any) => {
        if (it?.assetId) assetIds.add(String(it.assetId));
      });
      const { ids, urls } = splitAssetRefs(assetIds);
      const assetOr: any[] = [
        ...(ids.length ? [{ _id: { $in: ids } }] : []),
        ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : [])
      ];
      const assets = assetOr.length ? await Asset.find({ $or: assetOr }) : [];
      
      const hasWarning = assets.length < assetIds.size || assets.some(a => !a.dpi || a.dpi < 150);
      const assetsById = new Map<string, string>();
      assets.forEach((a: any) => {
        const id = a?._id ? String(a._id) : "";
        const url = typeof a?.trimmedUrl === "string" ? a.trimmedUrl : typeof a?.url === "string" ? a.url : "";
        if (id && url) assetsById.set(id, url);
      });
      const faceThumbnail = computeGangsheetFaceThumbnail({ items: order.items as any, assetsById });

      return {
        id: order.id,
        actualId: order.id,
        displayId: (order as any)?.displayId ? String((order as any).displayId) : null,
        customerName: `${order.customer.firstName} ${order.customer.lastName}`,
        sheetSize,
        filmType: firstItem.type === "gangsheet" ? "DTF" : "Unknown",
        location,
        status: displayStatus,
        dueDate: formatDueDate(order.createdAt),
        isUrgent: order.priority === "URGENT",
        hasWarning,
        statusDescription: statusDescription(displayStatus),
        thumbnail: faceThumbnail || (typeof firstItem.previewImage === "string" ? firstItem.previewImage : null)
      };
    }));

    const lastOrder = pageOrders[pageOrders.length - 1];
    const nextCursor =
      hasNextPage && lastOrder
        ? `${new Date(lastOrder.createdAt).getTime()}_${String(lastOrder._id)}`
        : null;

    res.json({ orders: formattedOrders, nextCursor });
  } catch (error) {
    next(error);
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           

export const getPrinterJobOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(jobId) ? String(jobId[0] || "") : String(jobId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid job id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: id, assignedPrinter: printerId }).lean();
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const items = Array.isArray((job as any).items) ? (job as any).items : [];
    const firstItem: any = (job as any).items?.[0] || {};
    const sheetSize =
      firstItem.widthIn && firstItem.heightIn ? `${firstItem.widthIn}x${firstItem.heightIn}` : "N/A";

    const designIdsRaw =
      (job as any).items?.filter((i: any) => i.designId).map((i: any) => String(i.designId)) || [];
    const designIds = designIdsRaw
      .filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id))
      .map((id: string) => new mongoose.Types.ObjectId(id));
    const designs = designIds.length ? await Design.find({ _id: { $in: designIds } }).lean() : [];
    const assetIds = new Set<string>();
    for (const d of designs as any[]) {
      d.artboardData?.items?.forEach((item: any) => {
        if (item.assetId) assetIds.add(String(item.assetId));
      });
    }
    const gangsheetItem = ((job as any).items || []).find((i: any) => i?.type === "gangsheet") || ((job as any).items || [])[0] || {};
    const jobArtboardItems = Array.isArray((gangsheetItem as any).artboardItems) ? (gangsheetItem as any).artboardItems : [];
    jobArtboardItems.forEach((it: any) => {
      if (it?.assetId) assetIds.add(String(it.assetId));
    });
    const { ids, urls } = splitAssetRefs(assetIds);
    const assets =
      ids.length || urls.length
        ? await Asset.find({
            $or: [
              ...(ids.length ? [{ _id: { $in: ids } }] : []),
              ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : [])
            ]
          }).lean()
        : [];
    const hasWarning = assets.length < assetIds.size || assets.some((a: any) => !a.dpi || a.dpi < 150);
    const assetsById = new Map<string, string>();
    assets.forEach((a: any) => {
      const id = a?._id ? String(a._id) : "";
      const url = typeof a?.trimmedUrl === "string" ? a.trimmedUrl : typeof a?.url === "string" ? a.url : "";
      if (id && url) assetsById.set(id, url);
    });
    const faceThumbnail = computeGangsheetFaceThumbnail({ items, assetsById });

    const exports = await GangsheetExport.find({
      jobId: new mongoose.Types.ObjectId(String((job as any)._id)),
      printerId: new mongoose.Types.ObjectId(String(printerId))
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .lean();

    const storedPricing = (job as any).pricing || {};
    const currency = String(storedPricing.currency || "USD");
    const storedAdjustments = Array.isArray(storedPricing.adjustments) ? storedPricing.adjustments : [];

    const partner = printerId
      ? await User.findById(printerId).select("settings.pricing").lean()
      : null;
    const partnerPricing = (partner as any)?.settings?.pricing || {};
    const breakdown = computePartnerCostBreakdown({
      items,
      partnerPricing,
      priority: (job as any).priority,
      adjustments: storedAdjustments,
    });

    const base = roundMoney(breakdown.base);
    const surcharges = roundMoney(breakdown.surcharges);
    const partnerCost = roundMoney(breakdown.subtotal);
    const total = partnerCost;
    const earning = partnerCost;
    const commission = 0;
    const tax = 0;

    res.json({
      id: String((job as any)._id),
      orderId: (job as any)?.displayId ? String((job as any).displayId) : String((job as any)._id),
      displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
      status: String((job as any).status),
      priority: String((job as any).priority || "NORMAL"),
      createdAt: (job as any).createdAt,
      updatedAt: (job as any).updatedAt,
      faceThumbnail,
      customer: {
        name: `${(job as any).customer?.firstName || ""} ${(job as any).customer?.lastName || ""}`.trim(),
        email: (job as any).customer?.email || null,
        phone: (job as any).customer?.phone || null,
        region: (job as any).customer?.region || null
      },
      shippingAddress: (job as any).shippingAddress || null,
      specs: {
        sheetSize,
        filmType: firstItem.type === "gangsheet" ? "DTF" : "Unknown",
        itemsCount: Array.isArray((job as any).items) ? (job as any).items.length : 0
      },
      notes: (job as any).notes || "",
      timeline: ((job as any).statusTimeline || []).map((t: any) => ({
        status: t.status,
        time: t.time,
        message: t.message || null,
        actorRole: t.actorRole || null,
        actorId: t.actorId || null,
        actorName: t.actorName ?? null
      })),
      payment: {
        method: (job as any).payment?.method || null,
        status: String((job as any).status || "").toUpperCase() === "CANCELLED" ? "cancelled" : "secured"
      },
      pricing: {
        subtotal: base,
        partnerCost,
        rushFee: surcharges,
        shippingCost: null,
        tax,
        total,
        currency
      },
      earnings: {
        gross: total,
        commission,
        net: earning,
        currency
      },
      warnings: { hasWarning },
      recentExports: exports.map((e: any) => ({
        id: String(e._id),
        fileName: e.fileName,
        dpi: e.dpi,
        createdAt: e.createdAt,
        drive: e.drive?.status === "uploaded" ? { webViewLink: e.drive.webViewLink } : null
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const getPrinterOrdersSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const match: any = { assignedPrinter: new mongoose.Types.ObjectId(printerId) };

    const [counts, urgentCount] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]),
      Order.countDocuments({
        assignedPrinter: printerId,
        priority: "URGENT",
        status: { $in: ["PENDING", "PROCESSING", "PRINTING"] }
      })
    ]);

    const byStatus = new Map<string, number>(counts.map((c: any) => [String(c._id), Number(c.count || 0)]));
    const pendingReview = (byStatus.get("PENDING") || 0);
    const inProgress = (byStatus.get("PROCESSING") || 0) + (byStatus.get("PRINTING") || 0);
    const ready = (byStatus.get("QUALITY_CHECK") || 0);
    const completed = (byStatus.get("SHIPPED") || 0) + (byStatus.get("COMPLETED") || 0);
    const cancelled = (byStatus.get("CANCELLED") || 0);

    res.json({
      counts: {
        all: Array.from(byStatus.values()).reduce((a, b) => a + b, 0),
        pending: pendingReview,
        inProgress,
        ready,
        completed,
        cancelled,
        urgent: urgentCount
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updatePrinterOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(orderId) ? String(orderId[0] || "") : String(orderId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid order id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const { status } = req.body || {};
    const input = String(status || "").trim();
    if (!input) {
      const error = new Error("status is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const allowedLabels: Record<string, string> = {
      "Pending Review": "PENDING",
      "In Progress": "PRINTING",
      "Ready": "QUALITY_CHECK",
      "Completed": "COMPLETED",
      "Cancelled": "CANCELLED"
    };

    const normalized = allowedLabels[input] || input.toUpperCase();
    const allowedBackend = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "SHIPPED", "COMPLETED", "CANCELLED"];
    if (!allowedBackend.includes(normalized)) {
      const error = new Error("Invalid status") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: id, assignedPrinter: printerId });
    if (!job) {
      const error = new Error("Order not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const current = String((job as any).status || "").toUpperCase();
    const next = normalized;

    const canTransition = (() => {
      if (next === current) return true;
      if (current === "COMPLETED") return false;
      if (next === "CANCELLED") return true;
      if (next === "PENDING") return ["PENDING", "PROCESSING", "PRINTING"].includes(current);
      if (next === "PROCESSING") return ["PENDING", "PROCESSING"].includes(current);
      if (next === "PRINTING") return ["PENDING", "PROCESSING", "PRINTING"].includes(current);
      if (next === "QUALITY_CHECK") return ["PENDING", "PRINTING", "QUALITY_CHECK", "PROCESSING"].includes(current);
      if (next === "SHIPPED") return ["QUALITY_CHECK", "SHIPPED"].includes(current);
      if (next === "COMPLETED") return ["SHIPPED", "QUALITY_CHECK", "COMPLETED"].includes(current);
      return false;
    })();

    if (!canTransition) {
      const error = new Error(`Invalid status transition from ${current} to ${next}`) as CustomError;
      error.statusCode = 409;
      throw error;
    }

    if (!job.statusTimeline) job.statusTimeline = [];
    const now = new Date();
    const timelineHas = (s: string) =>
      (job.statusTimeline || []).some((t: any) => String(t?.status || "").toUpperCase() === s);
    const pushStatus = (s: string) => {
      (job.statusTimeline as any).push({
        status: s as any,
        time: now,
        message: `Printer updated status to ${s}`,
        actorRole: "PRINTER",
        actorId: String(printerId || ""),
        actorName: null
      } as any);
    };

    if (next === "QUALITY_CHECK" && !timelineHas("PRINTING")) pushStatus("PRINTING");

    job.status = next as any;
    pushStatus(next);
    await job.save();

    res.json({ updated: true, id: job.id, status: normalized, updatedAt: job.updatedAt.toISOString() });
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
      "In Progress": ["PROCESSING", "PRINTING"],
      "Ready": ["QUALITY_CHECK"],
      "Completed": ["SHIPPED", "COMPLETED"],
      "Cancelled": ["CANCELLED"]
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
      displayId: (order as any)?.displayId ? String((order as any).displayId) : null,
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
    const printer = printerId ? await User.findById(printerId).select("settings.pricing").lean() : null;
    const partnerPricing = (printer as any)?.settings?.pricing || {};

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
      const amount = computePartnerCostBreakdown({
        items: Array.isArray((order as any).items) ? (order as any).items : [],
        partnerPricing,
        priority: (order as any).priority,
        adjustments: Array.isArray((order as any)?.pricing?.adjustments) ? (order as any).pricing.adjustments : [],
      }).subtotal;
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
    const printer = printerId ? await User.findById(printerId).select("settings.pricing").lean() : null;
    const partnerPricing = (printer as any)?.settings?.pricing || {};

    const query: any = { assignedPrinter: printerId };

    if (status) {
      if (status === "Paid") {
        query.status = { $in: ["SHIPPED", "COMPLETED"] };
      } else if (status === "Pending") {
        query.status = { $nin: ["SHIPPED", "COMPLETED", "CANCELLED", "REJECTED"] };
      }
    }

    const orders = await Order.find(query).sort({ updatedAt: -1 });

    const jobs = orders.map(order => {
      const amount = computePartnerCostBreakdown({
        items: Array.isArray((order as any).items) ? (order as any).items : [],
        partnerPricing,
        priority: (order as any).priority,
        adjustments: Array.isArray((order as any)?.pricing?.adjustments) ? (order as any).pricing.adjustments : [],
      }).subtotal;
      const commission = 0;
      const earning = amount;
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
    const printer = printerId ? await User.findById(printerId).select("settings.pricing").lean() : null;
    const partnerPricing = (printer as any)?.settings?.pricing || {};

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

    const orders = await Order.find({
      assignedPrinter: printerId,
      status: { $in: ["SHIPPED", "COMPLETED"] }
    });

    const totalAvailable = orders.reduce((sum, order) => {
      const earning = computePartnerCostBreakdown({
        items: Array.isArray((order as any).items) ? (order as any).items : [],
        partnerPricing,
        priority: (order as any).priority,
        adjustments: Array.isArray((order as any)?.pricing?.adjustments) ? (order as any).pricing.adjustments : [],
      }).subtotal;
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
