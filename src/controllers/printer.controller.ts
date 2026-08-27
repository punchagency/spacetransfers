import { Request, Response, NextFunction } from "express";
import { PRINTER_STATUS_LABEL, printerStatusLabel } from "../utils/orderStatusLabels.js";
import { deriveParcel } from "../services/packaging.service.js";
import { getGlobalPricing, totalBillableSqFt } from "../services/pricing.service.js";
import { Order } from "../models/order.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
import { User } from "../models/user.model.js";
import { Settings } from "../models/settings.model.js";
import { PrinterNotification } from "../models/printerNotification.model.js";
import { addPrinterNotificationClient, publishPrinterNotificationEvent, removePrinterNotificationClient } from "../services/printerNotificationsHub.js";
import { broadcastToAllAdmins } from "../services/adminNotificationsHub.js";
import { publishOrderEvent } from "../services/orderSyncHub.js";
import { notifyPrinter } from "../services/printerNotifications.service.js";
import { notifyAllAdmins } from "../services/adminNotifications.service.js";
import { isPrinterAvailableAt } from "../utils/businessHours.js";
import { resolveOrderDeadlineIso } from "../utils/assignmentDeadline.js";
import { geocodeAddress } from "../utils/geocoding.js";
import { getRegionFromState, getRegionFromCoords, normalizeRegion } from "../utils/region.js";
import archiver from "archiver";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import fs from "fs";
import path from "path";
import { Readable } from "node:stream";
import { GangsheetExport } from "../models/gangsheetExport.model.js";
import { GangsheetExportAudit } from "../models/gangsheetExportAudit.model.js";
import {
  exportGangsheetPng24,
  computeItemVerticalSpansIn,
  computeGangsheetCuts,
  GANGSHEET_SHEET_WIDTH_IN,
  GANGSHEET_PRINT_DPI,
} from "../services/gangsheetExport.service.js";
import { uploadPngToDrive } from "../services/googleDrive.service.js";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";
import { autoAssignOrder } from "../services/orderAssignment.service.js";
import {
  syncPartnerCapacity,
  syncPartnerCapacitySafe,
  getAssignmentSettings,
  getEffectiveMaxConcurrent,
  countActiveJobs,
} from "../services/partnerCapacity.service.js";
import {
  triggerShipStationWorkflow,
  isShipStationConfigured,
  createShipStationOrder,
  createShipStationLabel,
} from "../services/shipstation.service.js";
import { uploadBufferToCloudinary } from "../utils/cloudinary.js";
import sharp from "sharp";
import PDFDocument from "pdfkit";

// In-memory export job queue — lets the HTTP response return immediately while
// the (potentially slow) PNG render runs in the background.
type ExportJobStatus = "queued" | "processing" | "done" | "failed";
interface InMemoryExportJob {
  status: ExportJobStatus;
  progress?: number;
  message?: string;
  result?: {
    exportId: string;
    dpi: number;
    sheet: { widthIn: number; heightIn: number };
    validation: { ok: boolean; errors: string[]; meta?: any };
    drive: { uploaded: boolean; fileId?: string; webViewLink?: string; error?: string } | null;
  };
  error?: string;
  createdAt: number;
}
const exportJobStore = new Map<string, InMemoryExportJob>();

/** The artboard's fixed sheet width. Exports must match it exactly. */
/** Re-exported locally for readability; the definition lives with the renderer. */
const GANGSHEET_WIDTH_IN = GANGSHEET_SHEET_WIDTH_IN;

/**
 * Target printed length per exported part.
 *
 * A target rather than a hard boundary: a graphic straddling the line pushes
 * the cut down to its far edge (see `computeGangsheetCuts`), so a part may run
 * longer than this, but never splits a piece of artwork.
 */
const GANGSHEET_TARGET_LENGTH_IN = 100;
// Purge jobs older than 1 hour to prevent unbounded memory growth.
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [k, v] of exportJobStore) {
    if (v.createdAt < cutoff) exportJobStore.delete(k);
  }
}, 300_000).unref();

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

export const uploadProfileAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const file = req.file;
    const { type } = req.body; // 'avatar' or 'certification'

    if (!file) {
      const error = new Error("No file uploaded") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const user = await User.findById(printerId);
    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (type === "avatar") {
      const optimizedBuffer = await sharp(file.buffer)
        .resize(400, 400, { fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
      const { url } = await uploadBufferToCloudinary(optimizedBuffer, "space-transfers/avatars");
      user.avatarUrl = url;
      await user.save();
      return res.json({ message: "Avatar uploaded and optimized", url });
    }

    const { url } = await uploadBufferToCloudinary(file.buffer, "space-transfers/certifications");
    res.json({ message: "Document uploaded successfully", url });
  } catch (error) {
    next(error);
  }
};

const calcEarning = (order: any): number => {
  const items: any[] = Array.isArray(order.items) ? order.items : [];
  const fromItems = items.reduce((s: number, item: any) => {
    const sub = typeof item.subtotal === "number"
      ? item.subtotal
      : (typeof item.unitPrice === "number" ? item.unitPrice * (item.quantity || 1) : 0);
    return s + sub;
  }, 0);
  if (fromItems > 0) return fromItems;
  return typeof order.pricing?.subtotal === "number"
    ? order.pricing.subtotal
    : (typeof order.pricing?.total === "number" ? order.pricing.total : 0);
};

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slaAcceptHours = (await getAssignmentSettings()).sla.acceptHours;
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
    })
      .select("displayId status updatedAt createdAt items pricing priority customer")
      .lean();

    const todayCompleted = printerOrders.filter(o =>
      (o.status === "COMPLETED" || o.status === "SHIPPED") && o.updatedAt >= todayStart
    );
    const todayEarnings = todayCompleted.reduce((sum, o) => sum + calcEarning(o), 0);

    const yesterdayCompleted = printerOrders.filter(o =>
      (o.status === "COMPLETED" || o.status === "SHIPPED") &&
      o.updatedAt >= yesterdayStart && o.updatedAt <= yesterdayEnd
    );
    const yesterdayEarnings = yesterdayCompleted.reduce((sum, o) => sum + calcEarning(o), 0);

    const completedTodayCount = todayCompleted.length;
    const completedYesterdayCount = yesterdayCompleted.length;

    const totalPendingCount = await Order.countDocuments({ assignedPrinter: printerId, status: "PENDING" });
    const yesterdayPendingCount = await Order.countDocuments({
      assignedPrinter: printerId,
      status: "PENDING",
      createdAt: { $lt: todayStart }
    });

    // Total revenue = all earnings except cancelled/rejected — matches payout summary totalEarnings
    const [allActiveOrders, allActiveBeforeToday] = await Promise.all([
      Order.find({
        assignedPrinter: printerId,
        status: { $nin: ["CANCELLED", "REJECTED"] },
      })
        .select("items pricing")
        .lean(),
      Order.find({
        assignedPrinter: printerId,
        status: { $nin: ["CANCELLED", "REJECTED"] },
        updatedAt: { $lt: todayStart },
      })
        .select("items pricing")
        .lean(),
    ]);

    const totalRevenue = allActiveOrders.reduce((sum, o) => sum + calcEarning(o), 0);
    const totalRevenueBeforeToday = allActiveBeforeToday.reduce((sum, o) => sum + calcEarning(o), 0);

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

    // One shared map — see `utils/orderStatusLabels`.
    const mapStatus = printerStatusLabel;

    const assignedJobs = activeAssignedJobs.map((job: any) => ({
      id: String(job._id),
      displayId: job?.displayId ? String(job.displayId) : null,
      customerName: `${job.customer?.firstName || ""} ${job.customer?.lastName || ""}`.trim(),
      order: `${Array.isArray(job.items) ? job.items.length : 0} Items`,
      // ISO deadline (assignment + 24h); the frontend renders a live countdown.
      deadline: resolveOrderDeadlineIso(job, slaAcceptHours),
      assignedAt: job.assignedAt ? new Date(job.assignedAt).toISOString() : null,
      status: mapStatus(String(job.status || "")),
      isUrgent: String(job.priority || "").toUpperCase() === "URGENT",
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null
    }));

    const urgentJobs = await Order.find({ 
      assignedPrinter: printerId,
      priority: "URGENT",
      status: { $in: ["PENDING", "PROCESSING"] }
    }).select("displayId customer items createdAt assignedAt assignmentDeadline priority status").sort({ createdAt: 1 }).limit(5);

    const formattedUrgentJobs = urgentJobs.map(job => ({
      id: job.id,
      displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
      customerName: `${job.customer.firstName} ${job.customer.lastName}`,
      order: `${job.items.length} Items`,
      deadline: resolveOrderDeadlineIso(job, slaAcceptHours),
      assignedAt: (job as any).assignedAt ? new Date((job as any).assignedAt).toISOString() : null,
      status: "Urgent",
      isUrgent: true,
      createdAt: job.createdAt.toISOString()
    }));

    const fmtMoney = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    res.json({
      cards: [
        {
          label: "Today's Earnings",
          value: fmtMoney(todayEarnings),
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
          trend: `${totalPendingCount - yesterdayPendingCount > 0 ? "+" : ""}${totalPendingCount - yesterdayPendingCount}`,
          trendUp: totalPendingCount <= yesterdayPendingCount
        },
        {
          label: "Total Revenue",
          value: fmtMoney(totalRevenue),
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
    const slaAcceptHours = (await getAssignmentSettings()).sla.acceptHours;
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
        deadline: resolveOrderDeadlineIso(job, slaAcceptHours),
        assignedAt: (job as any).assignedAt ? new Date((job as any).assignedAt).toISOString() : null,
        createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
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

    // Completing (or otherwise moving out of an active state) frees capacity.
    syncPartnerCapacitySafe(String(printerId));

    // Was a second, disagreeing copy: "Quality Check" here vs "Print Shipping
    // Label" in the job list, for the same state and the same reader.
    const pqLabelMap = PRINTER_STATUS_LABEL;
    notifyPrinter({
      printerId: String(printerId),
      category: "jobs",
      priority: status === "COMPLETED" ? "medium" : "low",
      title: `Print queue job → ${pqLabelMap[status] || status}`,
      message: `Order ${(job as any).displayId || job.id} moved to ${pqLabelMap[status] || status}.`,
      meta: { orderId: job.id, status },
      settingsKey: "orderUpdates",
    }).catch(() => {});

    res.json({
      id: job.id,
      status: job.status,
      updatedAt: job.updatedAt.toISOString()
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

    const allowedActions = ["ACCEPT", "START"];
    if (!action || !allowedActions.includes(action)) {
      const error = new Error("Invalid action. Must be one of: ACCEPT | START") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    // Business hours enforcement for ACCEPT
    if (action === "ACCEPT") {
      const printer = await User.findById(printerId).select("settings.businessHours settings.jobCapacity name companyName email").lean();
      if (printer && !isPrinterAvailableAt(printer)) {
        const error = new Error("Action not allowed outside your configured business hours") as CustomError;
        error.statusCode = 403;
        throw error;
      }
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
      /*
       * REJECT, PAUSE and RESUME removed with the REJECTED and PAUSED statuses.
       * Declining a job is `cancelPrinterOrder`, which returns the order to
       * PENDING and reassigns it — the order gets re-homed rather than stranded
       * in a terminal state, and unlike these it is reachable from the app.
       */
      case "START":
        if (job.status !== "PROCESSING") {
          const error = new Error(`Cannot START job in ${job.status} state. START transitions Processing -> Printing.`) as CustomError;
          error.statusCode = 409;
          throw error;
        }
        nextStatus = "PRINTING";
        break;
    }

    job.status = nextStatus;
    if (!job.statusTimeline) job.statusTimeline = [];
    job.statusTimeline.push({
      status: nextStatus as any,
      time: new Date(),
    });
    await job.save();

    const displayId = (job as any).displayId || String(job._id).slice(-6).toUpperCase();

    const actionLabelMap: Record<string, { title: string; priority: "high" | "medium" | "low" }> = {
      ACCEPT: { title: "Job accepted",         priority: "medium" },
      START:  { title: "Job started printing", priority: "low"    },
    };
    const { title: actionTitle, priority: actionPriority } =
      actionLabelMap[action] || { title: `Job action: ${action}`, priority: "low" as const };

    notifyPrinter({
      printerId: String(printerId),
      category: "jobs",
      priority: actionPriority,
      title: actionTitle,
      message: `Order #${displayId} — ${actionTitle.toLowerCase()}.`,
      meta: { orderId: String(job._id), action, status: nextStatus },
      settingsKey: "orderUpdates",
    }).catch(() => {});

    res.json({ id: job.id, status: job.status });
  } catch (error) {
    next(error);
  }
};

const computeThumbUrl = (assetUrl: string | null | undefined): string | null => {
  if (!assetUrl) return null;
  const lastSlash = assetUrl.lastIndexOf("/");
  const lastDot = assetUrl.lastIndexOf(".");
  if (lastDot <= lastSlash) return null;
  return assetUrl.substring(0, lastDot) + "-thumb200.webp";
};

export const getJobAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;
    const pageSize = Math.max(1, Math.min(500, parseInt(String(req.query.limit || "200"), 10) || 200));
    const pageNum = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId })
      .select("items")
      .lean();

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const assetIdSet = new Set<string>();

    for (const item of (job as any).items || []) {
      if (item.type === "gangsheet" || item.artboardItems) {
        if (Array.isArray(item.artboardItems) && item.artboardItems.length > 0) {
          for (const ai of item.artboardItems) {
            if (ai.assetId) assetIdSet.add(String(ai.assetId));
          }
        } else if (item.designId && isObjectIdString(String(item.designId))) {
          const design = await Design.findById(item.designId).select("artboardData").lean();
          if (design?.artboardData?.items) {
            for (const di of (design as any).artboardData.items) {
              if (di.assetId) assetIdSet.add(String(di.assetId));
            }
          }
        }
      }
    }

    // Paginate the ID set — no DB skip/limit needed, just slice the array.
    const allIds = Array.from(assetIdSet);
    const total = allIds.length;
    const offset = (pageNum - 1) * pageSize;
    const pageIds = allIds.slice(offset, offset + pageSize);

    const { ids, urls } = splitAssetRefs(new Set(pageIds));
    const assets = pageIds.length
      ? await Asset.find({
          $or: [
            ...(ids.length ? [{ _id: { $in: ids } }] : []),
            ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : []),
          ],
        }).select("url trimmedUrl originalFilename widthPx heightPx dpi sizeBytes")
      : [];

    const uniqueAssetsMap = new Map<string, any>();
    for (const asset of assets) {
      const url = asset.url;
      if (url && !uniqueAssetsMap.has(url)) {
        uniqueAssetsMap.set(url, {
          id: asset.id,
          filename: asset.originalFilename,
          widthPx: asset.widthPx,
          heightPx: asset.heightPx,
          dpi: asset.dpi,
          downloadUrl: asset.url,
          thumbnailUrl: computeThumbUrl(asset.trimmedUrl || asset.url),
          sizeBytes: asset.sizeBytes || 0,
        });
      }
    }

    const formattedAssets = Array.from(uniqueAssetsMap.values());
    const totalBytes = formattedAssets.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);

    res.json({
      assets: formattedAssets,
      total,
      counts: { images: total, totalBytes },
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

    const bundleBase = env.appUrl && !env.appUrl.includes("localhost") ? env.appUrl : `http://localhost:${env.port || 4000}`;
    res.status(201).json({
      bundleDownloadUrl: `${bundleBase}/api/printer/jobs/${encodeURIComponent(String(job.id))}/assets/bundle/download${
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

    const exportJobId = crypto.randomUUID();
    exportJobStore.set(exportJobId, { status: "queued", createdAt: Date.now() });

    // Fire-and-forget: render happens in background so the HTTP response returns immediately.
    (async () => {
      exportJobStore.set(exportJobId, { ...exportJobStore.get(exportJobId)!, status: "processing" });
      try {
        // Preserve croppedUrl — it holds the trimmedUrl (full-res, server-processed) or
        // a data URL from canvas fallback / AI background removal. Stripping it causes the
        // export to fall back to the ORIGINAL (untrimmed) Cloudinary URL and resize it into
        // the trimmed bounding box via fit:"fill", which distorts the image.
        const fullResItems = artboardItems.map((it: any) => ({
          assetId: String(it.assetId || ""),
          croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
          // Pixel dimensions of the croppedUrl source — provided by the client for
          // canvas-processed items (canvas crop, BG removal) so the DPI calculation
          // uses the ACTUAL exported pixel count, not the DB's pre-crop original.
          croppedWidthPx: typeof it.croppedWidthPx === "number" && it.croppedWidthPx > 0 ? it.croppedWidthPx : undefined,
          widthIn: Number(it.widthIn),
          heightIn: Number(it.heightIn),
          posX: Number(it.posX),
          posY: Number(it.posY),
          rotation: typeof it.rotation === "number" ? it.rotation : 0,
          flipped: Boolean(it.flipped),
          copies: typeof it.copies === "number" ? it.copies : 1,
        }));

        // Determine export DPI from the native resolution of the ACTUAL source images.
        //
        // Priority order for pixel-count source:
        //   1. croppedWidthPx (client-supplied for canvas-processed items):
        //      The canvas output pixel count — always accurate regardless of DB state.
        //      Canvas crop shrinks the image (cropWidth < widthPx), so using widthPx
        //      would produce exportDpi = widthPx/widthIn >> actual, causing upscaling.
        //   2. trimmedWidthPx from DB (for Cloudinary-trimmed items):
        //      The server-trimmed image pixel count. widthIn = trimmedWidthIn so
        //      effectiveDpi = trimmedWidthPx/widthIn is the exact native DPI.
        //   3. widthPx from DB (fallback — original upload, pre-trim):
        //      Only used when no trim was performed and no canvas processing occurred.
        //
        // We take the MIN across all items so no source is ever upscaled:
        //   effectiveDpi = srcPx / it.widthIn
        //   exportDpi    = min(effectiveDpis), clamped [72, 600]
        const uniqueAssetIds = [
          ...new Set(
            fullResItems
              .filter((it) => !it.croppedWidthPx && mongoose.Types.ObjectId.isValid(it.assetId))
              .map((it) => it.assetId)
          ),
        ];
        const exportDpi = GANGSHEET_PRINT_DPI;
        {
          const effectiveDpis: number[] = [];

          // Items with client-supplied croppedWidthPx: use it directly — most accurate.
          for (const it of fullResItems) {
            if (!(it.widthIn > 0)) continue;
            if (typeof it.croppedWidthPx === "number" && it.croppedWidthPx > 0) {
              effectiveDpis.push(Math.round(it.croppedWidthPx / it.widthIn));
            }
          }

          // Items without croppedWidthPx: look up DB dimensions.
          if (uniqueAssetIds.length > 0) {
            const sourceAssets = await Asset.find({
              _id: { $in: uniqueAssetIds.map((id) => new mongoose.Types.ObjectId(id)) },
            })
              .select("dpi widthPx heightPx trimmedWidthPx trimmedHeightPx")
              .lean();
            const assetMap = new Map(
              (sourceAssets as any[]).map((a) => [String(a._id), a])
            );
            for (const it of fullResItems) {
              if (!(it.widthIn > 0) || it.croppedWidthPx) continue;
              const asset = assetMap.get(it.assetId) as any;
              if (!asset) continue;
              const srcPx =
                (typeof asset.trimmedWidthPx === "number" && asset.trimmedWidthPx > 0)
                  ? asset.trimmedWidthPx
                  : (typeof asset.widthPx === "number" && asset.widthPx > 0)
                  ? asset.widthPx
                  : null;
              if (srcPx !== null) {
                effectiveDpis.push(Math.round(srcPx / it.widthIn));
              } else if (typeof asset.dpi === "number" && asset.dpi > 0) {
                effectiveDpis.push(asset.dpi);
              }
            }
          }

          if (effectiveDpis.length > 0) {
            // Reported, not applied. Taking the MIN across sources used to set
            // the whole sheet's DPI, which let one low-resolution graphic
            // shrink the printed sheet's pixel width for every other graphic on
            // it. Per-placement under-resolution still surfaces through
            // `rendered.validation`.
            const lowest = Math.min(...effectiveDpis);
            if (lowest < GANGSHEET_PRINT_DPI) {
              console.warn(
                `[gangsheet] job=${job.id} lowest source DPI ${lowest} is below the ` +
                `${GANGSHEET_PRINT_DPI} DPI print target; those items are upscaled into their slots.`,
              );
            }
          }
        }

        const rendered = await exportGangsheetPng24({
          jobId: job.id,
          printerId: String(printerId),
          // Never `gangsheetItem.sheetWidthIn` — that field holds the artwork's
          // bounding width (checkout writes it for partner pricing), not the
          // sheet's. Item `posX` values are absolute against a 23.5" sheet, so
          // this is the only width that places them where the artboard did.
          sheetWidthIn: GANGSHEET_SHEET_WIDTH_IN,
          sheetHeightIn: gangsheetItem.sheetHeightIn ?? gangsheetItem.heightIn,
          artboardItems: fullResItems,
          dpi: exportDpi,
          // Full sheet — preserves the artboard layout 1:1 so item positions
          // match exactly what the customer approved.
          cropToContent: false,
          itemSpacingIn: typeof gangsheetItem.itemSpacingIn === "number" ? gangsheetItem.itemSpacingIn : undefined,
          sheetMarginIn: typeof gangsheetItem.sheetMarginIn === "number" ? gangsheetItem.sheetMarginIn : undefined,
        });

        // Structural errors (format mismatch, wrong dimensions, missing alpha) indicate a
        // genuinely broken file — fail hard. Resolution warnings are non-fatal.
        const structuralErrors = rendered.validation.errors.filter(
          (e) => !e.startsWith("asset_") && !e.includes("dpi") && !e.includes("colorspace"),
        );
        if (structuralErrors.length > 0) {
          exportJobStore.set(exportJobId, {
            ...exportJobStore.get(exportJobId)!,
            status: "failed",
            error: `Export failed: ${structuralErrors.join(", ")}`,
          });
          return;
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
          drive: { status: "skipped" },
        });

        await GangsheetExportAudit.create({
          exportId: exportDoc._id,
          jobId: exportDoc.jobId,
          printerId: exportDoc.printerId,
          action: "export_created",
          meta: { format: "png", dpi: rendered.dpi },
        });

        let driveResult: any = null;
        if (Boolean(toDrive)) {
          const uploaded = await uploadPngToDrive({ localFilePath: rendered.filePath, fileName: rendered.fileName });
          if (uploaded.uploaded) {
            await GangsheetExport.updateOne(
              { _id: exportDoc._id },
              { $set: { drive: { status: "uploaded", fileId: uploaded.fileId, webViewLink: uploaded.webViewLink, uploadedAt: new Date() } } },
            );
            await GangsheetExportAudit.create({
              exportId: exportDoc._id, jobId: exportDoc.jobId, printerId: exportDoc.printerId,
              action: "drive_uploaded", meta: { fileId: uploaded.fileId, webViewLink: uploaded.webViewLink },
            });
          } else {
            await GangsheetExport.updateOne(
              { _id: exportDoc._id },
              { $set: { drive: { status: "failed", error: uploaded.error || "drive_failed" } } },
            );
            await GangsheetExportAudit.create({
              exportId: exportDoc._id, jobId: exportDoc.jobId, printerId: exportDoc.printerId,
              action: "drive_failed", meta: { error: uploaded.error || "drive_failed" },
            });
          }
          driveResult = uploaded;
        }

        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "done",
          result: {
            exportId: String(exportDoc._id),
            dpi: rendered.dpi,
            sheet: rendered.sheet,
            validation: rendered.validation,
            drive: driveResult
              ? { uploaded: Boolean(driveResult.uploaded), fileId: driveResult.fileId, webViewLink: driveResult.webViewLink, error: driveResult.error }
              : null,
          },
        });
      } catch (err: any) {
        console.error("[export-job] failed", {
          exportJobId,
          jobId: job.id,
          printerId: String(printerId),
          message: err?.message,
          stack: err?.stack,
        });
        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "failed",
          error: err?.message || "Export failed",
        });
      }
    })().catch((err) => {
      console.error("[export-job] outer error", { exportJobId, err });
    });

    res.status(202).json({ exportJobId, status: "queued" });
  } catch (error) {
    next(error);
  }
};

export const getExportJobStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { exportJobId } = req.params;
    const job = exportJobStore.get(String(exportJobId || ""));
    if (!job) {
      const error = new Error("Export job not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }
    res.json(job);
  } catch (error) {
    next(error);
  }
};

export const getJobGangsheetPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const requestedResolution = Math.max(72, Math.min(100, parseInt(req.query.resolution as string) || 72));
    const printerId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(String(jobId))) {
      const error = new Error("Invalid job id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Fetch all artboard items but project only the 8 rendering fields — never loads
    // full artboard documents. 10k items × ~100 bytes = ~1 MB, vs MB-per-item without projection.
    const [jobRaw] = await (Order as any).aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(String(jobId)), assignedPrinter: new mongoose.Types.ObjectId(String(printerId)) } },
      { $project: {
        items: {
          $map: {
            input: { $ifNull: ["$items", []] },
            as: "item",
            in: {
              type: "$$item.type",
              widthIn: "$$item.widthIn",
              heightIn: "$$item.heightIn",
              sheetWidthIn: "$$item.sheetWidthIn",
              sheetHeightIn: "$$item.sheetHeightIn",
              itemSpacingIn: "$$item.itemSpacingIn",
              sheetMarginIn: "$$item.sheetMarginIn",
              artboardItems: {
                $map: {
                  input: { $ifNull: ["$$item.artboardItems", []] },
                  as: "ai",
                  in: {
                    assetId: "$$ai.assetId",
                    croppedUrl: "$$ai.croppedUrl",
                    widthIn: "$$ai.widthIn",
                    heightIn: "$$ai.heightIn",
                    posX: "$$ai.posX",
                    posY: "$$ai.posY",
                    rotation: "$$ai.rotation",
                    flipped: "$$ai.flipped",
                    copies: "$$ai.copies",
                  },
                },
              },
            },
          },
        },
      }},
    ]);

    if (!jobRaw) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const gangsheetItem = (jobRaw.items || []).find((i: any) => i?.type === "gangsheet") || (jobRaw.items || [])[0] || {};
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    /**
     * The sheet is always the full artboard width — never a value read off the
     * order item.
     *
     * `sheetWidthIn` sounds like the sheet's width and is not. The checkout
     * writes it as the artwork's *bounding* width (`headerInfo.widthIn`, i.e.
     * `max(bounds.maxX)`), because that is the area partner pricing charges
     * for — see `computePartnerCostBreakdown`, which multiplies it into the
     * square footage a partner is paid on. It is therefore load-bearing as a
     * pricing figure and is deliberately left alone.
     *
     * Rendering onto it was the bug: item `posX` values are absolute against a
     * 23.5" sheet, so a canvas sized to the artwork's bounding box put every
     * x-coordinate in the wrong place and clipped whatever fell past the new
     * right edge. That is the artboard/preview mismatch.
     */
    const sheetWidthIn = GANGSHEET_SHEET_WIDTH_IN;
    const sheetHeightIn = typeof gangsheetItem.sheetHeightIn === "number" && Number.isFinite(gangsheetItem.sheetHeightIn)
      ? gangsheetItem.sheetHeightIn : typeof gangsheetItem.heightIn === "number" && Number.isFinite(gangsheetItem.heightIn)
      ? gangsheetItem.heightIn : 23.5;

    const resolution = requestedResolution;

    // Preserve croppedUrl — it is the trimmedUrl (server-processed, full-res) for server-trimmed
    // assets, or a lossless data URL for canvas-cropped / AI bg-removed items. Stripping it
    // forces the export to use the original (untrimmed) Cloudinary URL and resize it into the
    // trimmed bounding box via fit:"fill", which squishes the image and causes visible distortion.
    const fullResItems = artboardItems.map((it: any) => ({
      assetId: it.assetId,
      croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
      widthIn: it.widthIn,
      heightIn: it.heightIn,
      posX: it.posX,
      posY: it.posY,
      rotation: it.rotation,
      flipped: it.flipped,
      copies: it.copies,
    }));

    // WebP has a hard 16383 px per-dimension limit. For very tall sheets (e.g. a
    // 1179" roll) this caps DPI to 13 — unacceptably low. PNG has no dimension
    // limit; it is instead capped by the 2 GB RGBA buffer, giving ~146 DPI for
    // the same sheet. Auto-switch to PNG when WebP would result in < 50 DPI.
    const WEBP_DIM_LIMIT = 16383;
    const MIN_WEBP_DPI = 50;
    const webpMaxDpi = Math.min(
      Math.floor(WEBP_DIM_LIMIT / Math.max(0.01, sheetWidthIn)),
      Math.floor(WEBP_DIM_LIMIT / Math.max(0.01, sheetHeightIn))
    );
    const previewFormat: "webp" | "png" = webpMaxDpi >= MIN_WEBP_DPI ? "webp" : "png";

    const rendered = await exportGangsheetPng24({
      jobId: String(jobId),
      printerId: String(printerId),
      sheetWidthIn,
      sheetHeightIn,
      artboardItems: fullResItems,
      dpi: resolution,
      cropToContent: true,
      /**
       * Every placement is rendered — no composite cap.
       *
       * This used to pass `maxComposites: 500`, which silently dropped
       * everything past the 500th placement. Real sheets run 1,200–2,600
       * placements, so the printer was shown roughly a third of the job, with
       * holes wherever the discarded pieces belonged: the crop bounds are
       * computed from *all* items, so the space was still reserved, it just
       * came out empty. That is the gaps-and-missing-artwork report.
       *
       * The cap also bought nothing. Unique images are decoded up front and
       * shared between placements, so a dropped placement only skips a buffer
       * blit, not a decode. Measured on the two largest live jobs, removing it
       * was no slower — 1,200 items: 3.8s → 3.1s; 2,612 items: 4.3s → 4.0s —
       * while the rendered output went from 766KB to 2.3MB of actual artwork.
       */
      format: previewFormat,
      useLossyPreview: true, // Use fast lossy WebP for preview
      itemSpacingIn: typeof gangsheetItem.itemSpacingIn === "number" ? gangsheetItem.itemSpacingIn : undefined,
      sheetMarginIn: typeof gangsheetItem.sheetMarginIn === "number" ? gangsheetItem.sheetMarginIn : undefined,
    });

    // Build a public-facing base URL from the request so the preview URL works
    // regardless of whether APP_URL is set. Heroku terminates TLS and sets
    // x-forwarded-proto, so we use that header instead of req.protocol.
    const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
    const host = req.get("host") || "";
    const derivedBase = host ? `${proto}://${host}` : null;
    const appBase = env.appUrl && !env.appUrl.includes("localhost") ? env.appUrl : derivedBase;
    const previewDataUrl = appBase ? `${appBase}${rendered.relativePath}` : rendered.relativePath;

    res.json({
      previewDataUrl,
      resolutionDPI: rendered.dpi,
      sheetWidthIn: rendered.sheet.widthIn,
      sheetHeightIn: rendered.sheet.heightIn,
      totalItems: artboardItems.length,
      cacheKey: rendered.cacheKey,
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

    const filePath = String((exp as any).filePath);
    const fileName = String((exp as any).fileName);

    // res.download() streams the file with a correct Content-Length, Content-Type
    // (from the extension — .zip → application/zip, .png → image/png), an
    // attachment Content-Disposition, and — critically — Accept-Ranges support so
    // the browser can resume a partial transfer. This replaces the previous
    // manual createReadStream().pipe(res), which buffered the whole file in page
    // memory on the client and corrupted large (hundreds-of-MB) split-gangsheet
    // zips.
    res.setHeader("Cache-Control", "no-store");
    res.download(filePath, fileName, (err) => {
      // A dropped connection mid-stream is expected and not actionable; only
      // surface a real error if we haven't started sending the body yet.
      if (err && !res.headersSent) next(err);
    });
  } catch (error) {
    next(error);
  }
};

export const downloadGangsheetPreviewPdf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params as any;
    const printerId = req.user?.id;

    if (!jobId || !mongoose.Types.ObjectId.isValid(String(jobId))) {
      const error = new Error("Invalid job id") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    if (!printerId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const [jobRaw] = await (Order as any).aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(String(jobId)), assignedPrinter: new mongoose.Types.ObjectId(String(printerId)) } },
      { $project: {
        displayId: 1,
        items: {
          $map: {
            input: { $ifNull: ["$items", []] },
            as: "item",
            in: {
              type: "$$item.type",
              widthIn: "$$item.widthIn",
              heightIn: "$$item.heightIn",
              sheetWidthIn: "$$item.sheetWidthIn",
              sheetHeightIn: "$$item.sheetHeightIn",
              itemSpacingIn: "$$item.itemSpacingIn",
              sheetMarginIn: "$$item.sheetMarginIn",
              artboardItems: {
                $map: {
                  input: { $ifNull: ["$$item.artboardItems", []] },
                  as: "ai",
                  in: {
                    assetId: "$$ai.assetId",
                    croppedUrl: "$$ai.croppedUrl",
                    widthIn: "$$ai.widthIn",
                    heightIn: "$$ai.heightIn",
                    posX: "$$ai.posX",
                    posY: "$$ai.posY",
                    rotation: "$$ai.rotation",
                    flipped: "$$ai.flipped",
                    copies: "$$ai.copies",
                  },
                },
              },
            },
          },
        },
      }},
    ]);

    if (!jobRaw) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const gangsheetItem = (jobRaw.items || []).find((i: any) => i?.type === "gangsheet") || (jobRaw.items || [])[0] || {};
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    /**
     * The sheet is always the full artboard width — never a value read off the
     * order item.
     *
     * `sheetWidthIn` sounds like the sheet's width and is not. The checkout
     * writes it as the artwork's *bounding* width (`headerInfo.widthIn`, i.e.
     * `max(bounds.maxX)`), because that is the area partner pricing charges
     * for — see `computePartnerCostBreakdown`, which multiplies it into the
     * square footage a partner is paid on. It is therefore load-bearing as a
     * pricing figure and is deliberately left alone.
     *
     * Rendering onto it was the bug: item `posX` values are absolute against a
     * 23.5" sheet, so a canvas sized to the artwork's bounding box put every
     * x-coordinate in the wrong place and clipped whatever fell past the new
     * right edge. That is the artboard/preview mismatch.
     */
    const sheetWidthIn = GANGSHEET_SHEET_WIDTH_IN;
    const sheetHeightIn = typeof gangsheetItem.sheetHeightIn === "number" && Number.isFinite(gangsheetItem.sheetHeightIn)
      ? gangsheetItem.sheetHeightIn : typeof gangsheetItem.heightIn === "number" && Number.isFinite(gangsheetItem.heightIn)
      ? gangsheetItem.heightIn : 23.5;

    // Preserve croppedUrl — it is the trimmedUrl (full-res, server-processed) for normally
    // uploaded assets, or a lossless PNG data URL for canvas-cropped / AI bg-removed items.
    // Stripping it makes the export download the untrimmed original and squeeze it into the
    // trimmed bounding box (fit:"fill"), producing a distorted / squished image.
    const fullResItems = artboardItems.map((it: any) => ({
      assetId: it.assetId,
      croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
      widthIn: it.widthIn,
      heightIn: it.heightIn,
      posX: it.posX,
      posY: it.posY,
      rotation: it.rotation,
      flipped: it.flipped,
      copies: it.copies,
    }));

    // Cap DPI so the rendered PNG stays within PDFKit's safe loading limit (~700 MB raw RGBA).
    // 175 M pixels × 4 bytes = 700 MB — safely under Node's 4 GB Buffer limit and PDFKit's
    // internal decompression cap. For a 22"×22" sheet this gives exactly 600 DPI (print grade).
    // For a 22"×60" roll it gives ~364 DPI. For the 98-foot roll (22"×1179") it gives ~83 DPI.
    const MAX_PDF_SAFE_PIXELS = 175_000_000;
    const pdfDpi = Math.max(10, Math.min(600,
      Math.floor(Math.sqrt(MAX_PDF_SAFE_PIXELS / Math.max(0.01, sheetWidthIn * sheetHeightIn)))
    ));

    const rendered = await exportGangsheetPng24({
      jobId: String(jobId),
      printerId: String(printerId),
      sheetWidthIn,
      sheetHeightIn,
      artboardItems: fullResItems,
      dpi: pdfDpi,
      cropToContent: true,
      format: "png",
      itemSpacingIn: typeof gangsheetItem.itemSpacingIn === "number" ? gangsheetItem.itemSpacingIn : undefined,
      sheetMarginIn: typeof gangsheetItem.sheetMarginIn === "number" ? gangsheetItem.sheetMarginIn : undefined,
    });

    const displayId = jobRaw.displayId
      ? String(jobRaw.displayId)
      : `ORD-${String(jobId).slice(-4).toUpperCase()}`;

    const PAGE_WIDTH_PTS  = rendered.sheet.widthIn  * 72;
    const PAGE_HEIGHT_PTS = rendered.sheet.heightIn * 72;

    // Build the PDF entirely in memory before sending.
    // Piping doc directly to res causes ERR_STREAM_WRITE_AFTER_END if doc.image()
    // throws: Express's error handler writes a JSON response to an already-piped
    // stream. Buffering means the try/catch above owns the response cleanly.
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: false });
    const pdfChunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => pdfChunks.push(chunk));

    doc.addPage({ size: [PAGE_WIDTH_PTS, PAGE_HEIGHT_PTS], margin: 0 });
    doc.image(rendered.filePath, 0, 0, { width: PAGE_WIDTH_PTS, height: PAGE_HEIGHT_PTS });

    await new Promise<void>((resolve, reject) => {
      doc.on("end", resolve);
      doc.on("error", reject);
      doc.end();
    });

    const pdfBuffer = Buffer.concat(pdfChunks);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gangsheet_${displayId}_preview.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

export const exportPngForDownload = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    if (!jobId || !mongoose.Types.ObjectId.isValid(String(jobId))) {
      const error = new Error("Invalid job id") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    if (!printerId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const [jobRaw] = await (Order as any).aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(String(jobId)), assignedPrinter: new mongoose.Types.ObjectId(String(printerId)) } },
      { $project: {
        displayId: 1,
        "customer.firstName": 1,
        "customer.lastName": 1,
        items: {
          $map: {
            input: { $ifNull: ["$items", []] },
            as: "item",
            in: {
              type: "$$item.type",
              widthIn: "$$item.widthIn",
              heightIn: "$$item.heightIn",
              sheetWidthIn: "$$item.sheetWidthIn",
              sheetHeightIn: "$$item.sheetHeightIn",
              itemSpacingIn: "$$item.itemSpacingIn",
              sheetMarginIn: "$$item.sheetMarginIn",
              artboardItems: {
                $map: {
                  input: { $ifNull: ["$$item.artboardItems", []] },
                  as: "ai",
                  in: {
                    assetId: "$$ai.assetId",
                    croppedUrl: "$$ai.croppedUrl",
                    widthIn: "$$ai.widthIn",
                    heightIn: "$$ai.heightIn",
                    posX: "$$ai.posX",
                    posY: "$$ai.posY",
                    rotation: "$$ai.rotation",
                    flipped: "$$ai.flipped",
                    copies: "$$ai.copies",
                  },
                },
              },
            },
          },
        },
      }},
    ]);

    if (!jobRaw) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const gangsheetItem = (jobRaw.items || []).find((i: any) => i?.type === "gangsheet") || (jobRaw.items || [])[0] || {};
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this job") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    const exportJobId = crypto.randomUUID();
    exportJobStore.set(exportJobId, { status: "queued", progress: 0, message: "Queued...", createdAt: Date.now() });

    (async () => {
      const setProgress = (progress: number, message: string) => {
        exportJobStore.set(exportJobId, { ...exportJobStore.get(exportJobId)!, progress, message });
      };

      try {
        exportJobStore.set(exportJobId, { ...exportJobStore.get(exportJobId)!, status: "processing" });
        setProgress(5, "Preparing export...");

        /**
         * The printed sheet is always the full artboard width.
         *
         * This used to fall back to `gangsheetItem.widthIn` when
         * `sheetWidthIn` was absent — the *item's* width, not the sheet's,
         * which on older orders produced an export a few inches wide with the
         * artwork packed into it. Positions are stored relative to a 23.5"
         * sheet, so the width has to be that or every x-coordinate is wrong.
         */
        const sheetWidthIn = GANGSHEET_WIDTH_IN;
        const sheetHeightIn = typeof gangsheetItem.sheetHeightIn === "number" && Number.isFinite(gangsheetItem.sheetHeightIn)
          ? gangsheetItem.sheetHeightIn : typeof gangsheetItem.heightIn === "number" && Number.isFinite(gangsheetItem.heightIn)
          ? gangsheetItem.heightIn : 23.5;

        const fullResItems = artboardItems.map((it: any) => ({
          assetId: String(it.assetId || ""),
          croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
          widthIn: Number(it.widthIn),
          heightIn: Number(it.heightIn),
          posX: Number(it.posX),
          posY: Number(it.posY),
          rotation: typeof it.rotation === "number" ? it.rotation : 0,
          flipped: Boolean(it.flipped),
          copies: typeof it.copies === "number" ? it.copies : 1,
        }));

        setProgress(10, "Generating PNG...");

        /**
         * The sheet renders at the print DPI, always.
         *
         * This used to take the *minimum* effective source DPI across every item
         * and render the whole sheet at that, to avoid ever upscaling. The
         * intent was right and the scope was wrong: one 150-DPI logo dropped the
         * entire sheet to 150, so a 23.5" sheet came out 3,525px instead of
         * 7,050 and every other graphic on it was downsampled by half to
         * accommodate the worst one. Resolution is a property of each image, not
         * of the sheet they share.
         *
         * Under-resolution is still detected and still reported — the renderer
         * records `asset_<id>_insufficient_px` for any placement whose source has
         * fewer pixels than its slot, and the customer is warned about the same
         * artwork at upload time by the low-DPI check. What no longer happens is
         * one soft image quietly resizing the printed sheet.
         */
        const uniqueAssetIdsForDpi: string[] = Array.from(
          new Set<string>(
            (fullResItems as any[])
              .filter((it: any) => !String(it.croppedUrl || "").startsWith("data:") && isObjectIdString(String(it.assetId || "")))
              .map((it: any) => String(it.assetId))
          )
        );
        const exportDpi = GANGSHEET_PRINT_DPI;
        /** Diagnostic only — no longer resizes the sheet. */
        let lowestSourceDpi: number | null = null;
        if (uniqueAssetIdsForDpi.length > 0) {
          const sourceAssets = await Asset.find({
            _id: { $in: uniqueAssetIdsForDpi.map((id: string) => new mongoose.Types.ObjectId(id)) },
          })
            .select("dpi widthPx trimmedWidthPx")
            .lean();
          const assetMap = new Map((sourceAssets as any[]).map((a) => [String(a._id), a]));
          const effectiveDpis: number[] = [];
          for (const it of fullResItems as any[]) {
            if (!(Number(it.widthIn) > 0) || String(it.croppedUrl || "").startsWith("data:")) continue;
            const asset = assetMap.get(String(it.assetId)) as any;
            if (!asset) continue;
            const srcPx =
              typeof asset.trimmedWidthPx === "number" && asset.trimmedWidthPx > 0
                ? asset.trimmedWidthPx
                : typeof asset.widthPx === "number" && asset.widthPx > 0
                ? asset.widthPx
                : null;
            if (srcPx !== null) {
              effectiveDpis.push(Math.round(srcPx / Number(it.widthIn)));
            } else if (typeof asset.dpi === "number" && asset.dpi > 0) {
              effectiveDpis.push(asset.dpi);
            }
          }
          if (effectiveDpis.length > 0) {
            lowestSourceDpi = Math.min(...effectiveDpis);
            if (lowestSourceDpi < GANGSHEET_PRINT_DPI) {
              console.warn(
                `[gangsheet] job=${jobId} lowest source DPI ${lowestSourceDpi} is below the ` +
                `${GANGSHEET_PRINT_DPI} DPI print target; those items are upscaled into their slots.`,
              );
            }
          }
        }

        const itemSpacingIn = typeof gangsheetItem.itemSpacingIn === "number" ? gangsheetItem.itemSpacingIn : undefined;
        const sheetMarginIn = typeof gangsheetItem.sheetMarginIn === "number" ? gangsheetItem.sheetMarginIn : undefined;

        /**
         * Cut lines that fall between graphics, not through them.
         *
         * Computed *before* any rendering now. They only need the placement
         * geometry, which is known from the items alone — and knowing them up
         * front is what lets each part be rendered as its own canvas instead of
         * being carved out of one enormous buffer. The cut arithmetic itself is
         * unchanged: same spans, same `computeGangsheetCuts`, same boundaries.
         */
        const spans = computeItemVerticalSpansIn({
          sheetWidthIn,
          artboardItems: fullResItems,
          itemSpacingIn,
          sheetMarginIn,
        });
        const cuts = computeGangsheetCuts({
          totalHeightIn: sheetHeightIn,
          spans,
          targetLengthIn: GANGSHEET_TARGET_LENGTH_IN,
        });
        const needsSplit = sheetHeightIn > GANGSHEET_TARGET_LENGTH_IN && cuts.length > 1;

        /**
         * Renders one window of the sheet at full print resolution.
         *
         * A whole 23.5"×1200" roll at 300 DPI is 7,050 × 360,000px — 10 GB of
         * RGBA, far past the renderer's 2 GB buffer ceiling, so it used to be
         * rendered once at whatever DPI *did* fit (~138) and sliced afterwards.
         * Every part therefore inherited that reduced resolution: 3,243px wide
         * instead of 7,050. Rendering per part instead keeps each canvas about
         * 23.5"×100" — well inside the ceiling — so the width is 7,050px at
         * 300 DPI for a sheet of any length.
         *
         * The window is expressed in sheet inches and handed to the renderer,
         * which offsets placements by its origin exactly as `cropToContent`
         * always did. No second layout is involved: item positions, ordering,
         * spacing and nesting are read unchanged.
         */
        const renderWindow = (windowIn?: { topIn: number; heightIn: number }) =>
          exportGangsheetPng24({
            jobId: String(jobId),
            printerId: String(printerId),
            sheetWidthIn,
            sheetHeightIn,
            artboardItems: fullResItems,
            dpi: exportDpi,
            cropToContent: false,
            format: "png",
            itemSpacingIn,
            sheetMarginIn,
            renderWindowIn: windowIn
              ? { leftIn: 0, topIn: windowIn.topIn, widthIn: sheetWidthIn, heightIn: windowIn.heightIn }
              : null,
          });

        // The un-split sheet is still a single full-sheet render, unchanged.
        const rendered = needsSplit
          ? await renderWindow({ topIn: cuts[0].startIn, heightIn: cuts[0].endIn - cuts[0].startIn })
          : await renderWindow();

        setProgress(60, "Processing export...");

        const firstName = String(jobRaw.customer?.firstName || "").trim();
        const lastName = String(jobRaw.customer?.lastName || "").trim();
        const customerName = [firstName, lastName].filter(Boolean).join(" ") || "Customer";
        const safeName = customerName.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "Customer";
        const dtfRaw = jobRaw.displayId ? String(jobRaw.displayId) : `ORD-${String(jobId).slice(-4).toUpperCase()}`;
        // Strip non-alphanumeric but preserve the numeric part. E.g. "DTF-0171" → "0171", "ORD-AB12" → "AB12"
        const dtfNum = dtfRaw.replace(/^[A-Za-z]+-?/g, "").replace(/[^a-zA-Z0-9]/g, "") || dtfRaw.replace(/[^a-zA-Z0-9]/g, "");
        const baseFilename = `${safeName}_DTF${dtfNum}`;

        const exportDir = path.join(process.cwd(), "uploads", "exports", "printers", String(printerId), String(jobId));
        await fs.promises.mkdir(exportDir, { recursive: true });


        let finalFilePath: string;
        let finalFileName: string;
        let finalByteSize: number;
        let finalFormat: "png" | "zip";

        if (!needsSplit) {
          setProgress(90, "Finalizing...");
          finalFilePath = rendered.filePath;
          finalFileName = `${baseFilename}.png`;
          finalByteSize = rendered.byteSize;
          finalFormat = "png";
        } else {
          const numParts = cuts.length;

          setProgress(65, `Splitting into ${numParts} part${numParts !== 1 ? "s" : ""}...`);

          const zipFilename = `${baseFilename}.zip`;
          const zipPath = path.join(exportDir, zipFilename);
          const zipOutput = fs.createWriteStream(zipPath);
          const zipArchive = archiver("zip", { zlib: { level: 6 } });
          zipArchive.pipe(zipOutput);

          /**
           * Each part is its own full-resolution render of its own band.
           *
           * Previously the whole sheet was rendered once and `sharp.extract`
           * carved the parts out of it, which is why every part inherited the
           * downscaled DPI the giant buffer had forced. The band boundaries are
           * the same `cuts` either way — back-to-back, so the parts still tile
           * the sheet exactly with nothing repeated and nothing dropped — and
           * part 1 is already rendered above.
           */
          for (let i = 0; i < numParts; i++) {
            const heightIn = cuts[i].endIn - cuts[i].startIn;
            if (!(heightIn > 0)) continue;

            const part =
              i === 0
                ? rendered
                : await renderWindow({ topIn: cuts[i].startIn, heightIn });

            const partBuf = await sharp(part.filePath, { limitInputPixels: false })
              .png({ compressionLevel: 1 })
              .withMetadata({ density: part.dpi })
              .toBuffer();

            zipArchive.append(partBuf, { name: `${baseFilename}_Part_${i + 1}.png` });
            setProgress(65 + Math.round(((i + 1) / numParts) * 20), `Processing part ${i + 1} of ${numParts}...`);
          }

          setProgress(86, "Creating ZIP...");

          await new Promise<void>((resolve, reject) => {
            zipOutput.on("close", resolve);
            zipOutput.on("error", reject);
            zipArchive.on("error", reject);
            zipArchive.finalize();
          });

          setProgress(94, "Saving...");
          const zipStats = await fs.promises.stat(zipPath);
          finalFilePath = zipPath;
          finalFileName = zipFilename;
          finalByteSize = zipStats.size;
          finalFormat = "zip";
        }

        const exportDoc = await GangsheetExport.create({
          jobId: new mongoose.Types.ObjectId(String(jobId)),
          printerId: new mongoose.Types.ObjectId(String(printerId)),
          format: finalFormat,
          dpi: rendered.dpi,
          sheet: rendered.sheet,
          fileName: finalFileName,
          filePath: finalFilePath,
          byteSize: finalByteSize,
          validation: rendered.validation,
          drive: { status: "skipped" },
        });

        await GangsheetExportAudit.create({
          exportId: exportDoc._id,
          jobId: exportDoc.jobId,
          printerId: exportDoc.printerId,
          action: "export_created",
          meta: { format: finalFormat, dpi: rendered.dpi },
        });

        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "done",
          progress: 100,
          message: "Complete",
          result: {
            exportId: String(exportDoc._id),
            dpi: rendered.dpi,
            sheet: rendered.sheet,
            validation: rendered.validation,
            drive: null,
          },
        });
      } catch (err: any) {
        console.error("[png-export] failed", { exportJobId, jobId, message: err?.message, stack: err?.stack });
        exportJobStore.set(exportJobId, {
          ...exportJobStore.get(exportJobId)!,
          status: "failed",
          error: err?.message || "Export failed",
        });
      }
    })().catch((err) => {
      console.error("[png-export] outer error", { exportJobId, err });
    });

    res.status(202).json({ exportJobId, status: "queued" });
  } catch (error) {
    next(error);
  }
};

export const createJobShippingLabel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { carrierId, serviceCode } = req.body;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!isShipStationConfigured()) {
      const error = new Error("ShipStation is not configured on this server") as CustomError;
      error.statusCode = 503;
      throw error;
    }

    const addr = (job as any).shippingAddress;
    if (!addr?.street || !addr?.city || !addr?.state || !addr?.postalCode) {
      const error = new Error("Incomplete shipping address — cannot generate label") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    // Clear idempotency lock so this manual trigger works even if a previous attempt failed.
    if ((job as any).shipStationTriggeredAt) {
      await Order.updateOne({ _id: job._id }, { $set: { shipStationTriggeredAt: null } });
    }

    const displayId = String((job as any).displayId ?? String(job._id).slice(-6).toUpperCase());

    const items = ((job as any).items ?? []).map((it: any) => ({
      name: String(it.name ?? it.type ?? "Print Item"),
      quantity: Number(it.quantity ?? 1),
      unitPrice: Number(it.unitPrice ?? 0),
    }));

    // Use the printer's business address as the ship-from address.
    const printer = await User.findById(printerId).select("name companyName phone businessAddress").lean();
    const bAddr = (printer as any)?.businessAddress;
    const shipFrom = bAddr?.street
      ? {
          name: String((printer as any).companyName || (printer as any).name || "Print Partner"),
          street1: String(bAddr.street),
          city: String(bAddr.city || ""),
          state: String(bAddr.state || ""),
          postalCode: String(bAddr.postalCode || ""),
          country: String(bAddr.country || "US"),
          phone: String((printer as any).phone || ""),
        }
      : undefined;

    const { shipStationOrderId } = await createShipStationOrder({
      displayId,
      customerFirstName: (job as any).customer.firstName,
      customerLastName: (job as any).customer.lastName,
      customerEmail: (job as any).customer.email,
      phone: (job as any).customer.phone,
      street: addr.street,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: addr.country ?? "US",
      items,
      totalAmount: Number((job as any).pricing?.total ?? 0),
      // The parcel recorded when the order was placed, so the label declares
      // the same thing the rate was quoted against. Falls back to deriving it
      // for orders that predate the field.
      parcel: (job as any).shippingQuote?.parcel?.weightLb
        ? {
            weightLb: Number((job as any).shippingQuote.parcel.weightLb),
            lengthIn: Number((job as any).shippingQuote.parcel.lengthIn),
            widthIn: Number((job as any).shippingQuote.parcel.widthIn),
            heightIn: Number((job as any).shippingQuote.parcel.heightIn),
          }
        : deriveParcel(
            totalBillableSqFt((job as any).items || []),
            (await getGlobalPricing()).packaging,
          ),
    });

    const { shipStationShipmentId, trackingNumber, labelUrl, carrier } =
      await createShipStationLabel({ shipStationOrderId, carrierCode: carrierId, serviceCode, shipFrom });

    const now = new Date();
    const timelineEntry = {
      status: "QUALITY_CHECK" as any,
      time: now,
      message: `Shipping label generated. Carrier: ${carrier}, Tracking: ${trackingNumber}. Awaiting printer confirmation.`,
      actorRole: "PRINTER",
      actorId: String(printerId || ""),
      actorName: null,
    };

    await Order.updateOne(
      { _id: job._id },
      {
        $set: {
          trackingNumber,
          carrier,
          shipStationOrderId,
          shipStationShipmentId,
          shipStationLabelUrl: labelUrl,
          shipStationTriggeredAt: now,
          updatedAt: now,
        },
        $push: { statusTimeline: timelineEntry },
      }
    );

    res.status(201).json({
      trackingNumber,
      labelUrl,
      carrier,
      shipStationOrderId,
      shipStationShipmentId,
      message: "Label generated — open the order to review and confirm shipment",
    });
  } catch (error) {
    next(error);
  }
};

export const reprintShippingLabel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId })
      .select("shipStationLabelUrl shipStationShipmentId status")
      .lean();
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const labelUrl = String((job as any).shipStationLabelUrl || "");
    if (labelUrl) {
      return res.json({ labelUrl });
    }

    const error = new Error("No shipping label on file for this order") as CustomError;
    error.statusCode = 404;
    throw error;
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
    
    let shippedNow = false;
    if (!["SHIPPED", "COMPLETED"].includes(job.status)) {
      job.status = "SHIPPED" as any;
      shippedNow = true;
      if (!job.statusTimeline) job.statusTimeline = [];
      job.statusTimeline.push({ status: "SHIPPED" as any, time: new Date() });
    }

    await job.save();

    // Shipping moves the job out of the active set, freeing a capacity slot.
    if (shippedNow) syncPartnerCapacitySafe(String(printerId));

    res.json({
      // `orderId` means the canonical DTF-#### number on every other printer
      // endpoint; this one returned the raw ObjectId under the same name.
      orderId: (job as any).displayId ? String((job as any).displayId) : job.id,
      trackingNumber: job.trackingNumber,
      updatedAt: job.updatedAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const listPrinterOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slaAcceptHours = (await getAssignmentSettings()).sla.acceptHours;
    const printerId = req.user?.id;
    const { status, q, limit = "30", cursor } = req.query;

    const query: any = { assignedPrinter: printerId };

    const statusMap: { [key: string]: any } = {
      "Pending Review": "PENDING",
      "In Progress - Printing": ["PROCESSING", "PRINTING"],
      "Print Shipping Label": ["QUALITY_CHECK"],
      "Order Shipped": ["SHIPPED"],
      "Completed": ["COMPLETED"],
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

    // Exclude artboardItems — they can be 10k+ elements per order and are never needed
    // in list view. Use previewImage for thumbnails instead.
    const orders = await Order.find(query)
      .select("-items.artboardItems")
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

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
      if (label === "In Progress - Printing") return "Currently printing";
      if (label === "Print Shipping Label") return "Label being generated via ShipStation";
      if (label === "Completed") return "Job completed successfully";
      if (label === "Cancelled") return "This job has been cancelled";
      return "";
    };

    const hasNextPage = orders.length > pageSize;
    const pageOrders = hasNextPage ? orders.slice(0, pageSize) : orders;

    const formattedOrders = pageOrders.map((order) => {
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

      const thumbnail = typeof firstItem.previewImage === "string" && firstItem.previewImage
        ? firstItem.previewImage
        : null;

      const orderId = String((order as any)._id);
      // Due date follows the fulfilment deadline (assignment + 24h), not the
      // order's creation time.
      const deadlineIso = resolveOrderDeadlineIso(order as any, slaAcceptHours);
      return {
        id: orderId,
        actualId: orderId,
        displayId: (order as any)?.displayId ? String((order as any).displayId) : null,
        customerName: `${order.customer.firstName} ${order.customer.lastName}`,
        sheetSize,
        filmType: firstItem.type === "gangsheet" ? "DTF" : "Unknown",
        location,
        status: displayStatus,
        dueDate: formatDueDate(deadlineIso ? new Date(deadlineIso) : order.createdAt),
        deadline: deadlineIso,
        assignedAt: (order as any).assignedAt ? new Date((order as any).assignedAt).toISOString() : null,
        createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
        isUrgent: order.priority === "URGENT",
        hasWarning: false,
        statusDescription: statusDescription(displayStatus),
        thumbnail,
      };
    });

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
    const slaAcceptHours = (await getAssignmentSettings()).sla.acceptHours;
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

    // Use the same cost formula the admin sees: printer's configured rate applied to sheet dimensions.
    const printerUser = await User.findById(printerId).select("settings.pricing").lean();
    const partnerPricing = (printerUser as any)?.settings?.pricing || {};
    const breakdown = computePartnerCostBreakdown({
      items: Array.isArray((job as any).items) ? (job as any).items : [],
      partnerPricing,
      priority: (job as any).priority,
      adjustments: (job as any)?.pricing?.adjustments || [],
    });
    const earning = breakdown.subtotal > 0 ? breakdown.subtotal : roundMoney(calcEarning(job));

    res.json({
      id: String((job as any)._id),
      orderId: (job as any)?.displayId ? String((job as any).displayId) : String((job as any)._id),
      displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
      status: String((job as any).status),
      priority: String((job as any).priority || "NORMAL"),
      createdAt: (job as any).createdAt,
      updatedAt: (job as any).updatedAt,
      assignedAt: (job as any).assignedAt ? new Date((job as any).assignedAt).toISOString() : null,
      // ISO fulfilment deadline (assignment + 24h); frontend renders a countdown.
      deadline: resolveOrderDeadlineIso(job as any, slaAcceptHours),
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
        subtotal: earning,
        partnerCost: earning,
        rushFee: 0,
        shippingCost: null,
        tax: 0,
        total: earning,
        currency
      },
      earnings: {
        gross: earning,
        commission: 0,
        net: earning,
        currency
      },
      warnings: { hasWarning },
      // Shipping & ShipStation fields — needed by the printer app to show tracking info
      // and to determine whether ShipStation is still processing.
      trackingNumber: (job as any).trackingNumber || null,
      carrier: (job as any).carrier || null,
      trackingUrl: (job as any).trackingUrl || null,
      shipStationTriggeredAt: (job as any).shipStationTriggeredAt
        ? new Date((job as any).shipStationTriggeredAt).toISOString()
        : null,
      shipStationLabelUrl: (job as any).shipStationLabelUrl || null,
      shipStationError: (job as any).shipStationError || null,
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
    const shipped = (byStatus.get("SHIPPED") || 0);
    const completed = (byStatus.get("COMPLETED") || 0);
    const cancelled = (byStatus.get("CANCELLED") || 0);

    res.json({
      counts: {
        all: Array.from(byStatus.values()).reduce((a, b) => a + b, 0),
        pending: pendingReview,
        inProgress,
        ready,
        shipped,
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
      // PROCESSING, not PENDING: the job is still assigned to this partner —
      // they are moving it back to "not started", not releasing it. PENDING now
      // means "no partner attached", so mapping here would have produced an
      // order that was pending and assigned at the same time.
      "Pending Review": "PROCESSING",
      "In Progress": "PRINTING",
      "In Progress - Printing": "PRINTING",
      "Print Shipping Label": "QUALITY_CHECK",
      "Ready": "QUALITY_CHECK",
      "Order Shipped": "SHIPPED",
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

    // Status rank — higher number = further along. Transitions must never decrease rank.
    const STATUS_RANK: Record<string, number> = {
      PENDING: 0,
      PROCESSING: 1,
      PRINTING: 2,
      QUALITY_CHECK: 3,
      SHIPPED: 4,
      COMPLETED: 5,
    };
    const currentRank = STATUS_RANK[current] ?? -1;
    const nextRank    = STATUS_RANK[next]    ?? -1;

    const canTransition = (() => {
      if (next === current) return true;          // no-op always fine
      if (next === "CANCELLED") return true;      // cancel is a separate semantic action
      if (current === "COMPLETED") return false;  // terminal state
      if (nextRank < 0 || currentRank < 0) return false; // unknown status
      return nextRank > currentRank;              // forward-only
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

    // Reconcile capacity — a move to SHIPPED/COMPLETED/CANCELLED frees a slot.
    syncPartnerCapacitySafe(String(printerId));

    // When the printer marks a job "Ready for Packaging" (QUALITY_CHECK), fire the
    // ShipStation workflow async: create a shipping order, generate a label, retrieve
    // the tracking number, and auto-advance the job to SHIPPED.
    if (next === "QUALITY_CHECK") {
      triggerShipStationWorkflow(String(job._id)).catch((err: any) => {
        console.error(
          `[SS] Fire-and-forget workflow error for order ${job._id}: ${err?.message}`
        );
      });
    }

    const statusLabelMap: Record<string, string> = {
      PENDING: "Pending Review",
      PRINTING: "In Progress - Printing",
      QUALITY_CHECK: "Print Shipping Label",
      SHIPPED: "Confirmed for Pickup",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled",
    };
    const statusLabel = statusLabelMap[next] || next;
    notifyPrinter({
      printerId: String(printerId),
      category: "jobs",
      priority: next === "COMPLETED" || next === "SHIPPED" ? "medium" : "low",
      title: `Job moved to ${statusLabel}`,
      message: `Order ${(job as any).displayId || job.id} status updated to ${statusLabel}.`,
      meta: { orderId: job.id, status: next },
      settingsKey: "orderUpdates",
    }).catch(() => {});

    // When printer confirms shipment (QUALITY_CHECK → SHIPPED), notify customer + admins.
    if (next === "SHIPPED") {
      const trackingNumber = String((job as any).trackingNumber || "");
      const carrier = String((job as any).carrier || "");
      const displayId = String((job as any).displayId || job.id);
      publishOrderEvent(String(job._id), "order.status.changed", {
        orderId: String(job._id),
        status: "SHIPPED",
        from: current,
        to: "SHIPPED",
        trackingNumber,
        carrier,
        updatedAt: now,
        lastTimelineEntry: (job.statusTimeline as any)[(job.statusTimeline as any).length - 1],
      });
      notifyAllAdmins({
        category: "orders",
        priority: "medium",
        title: "Order confirmed for pickup",
        message: `Order #${displayId} label printed — printer confirmed package is ready. Carrier: ${carrier}, Tracking: ${trackingNumber}.`,
        meta: { orderId: String(job._id), displayId, trackingNumber, carrier },
      }).catch(() => {});
    }

    res.json({ updated: true, id: job.id, status: normalized, updatedAt: job.updatedAt.toISOString() });
  } catch (error) {
    next(error);
  }
};

export const cancelPrinterOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(orderId) ? String(orderId[0] || "") : String(orderId || "");

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(String(printerId || ""))) {
      const error = new Error("Invalid order id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const { reason } = req.body || {};
    const cancelReason = typeof reason === "string" ? reason.trim() : "";

    // Load the job — must belong to this printer
    const job = await Order.findOne({
      _id: new mongoose.Types.ObjectId(id),
      assignedPrinter: new mongoose.Types.ObjectId(String(printerId)),
    }).select("status displayId statusTimeline assignmentHistory customer");

    if (!job) {
      const error = new Error("Order not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const current = String((job as any).status || "").toUpperCase();
    if (current === "CANCELLED") {
      const error = new Error("Order is already cancelled") as CustomError;
      error.statusCode = 409;
      throw error;
    }
    if (current === "COMPLETED") {
      const error = new Error("Cannot cancel a completed order") as CustomError;
      error.statusCode = 409;
      throw error;
    }

    // Look up printer name for logging
    const printerUser = await User.findById(printerId).select("name companyName").lean();
    const printerName = String((printerUser as any)?.companyName || (printerUser as any)?.name || printerId);

    const displayId = (job as any).displayId || String(job._id).slice(-6).toUpperCase();
    const now = new Date();

    const timelineEntry = {
      status: "PENDING",
      time: now,
      message: cancelReason
        ? `Returned to admin queue — cancelled by printer (${printerName}): ${cancelReason}`
        : `Returned to admin queue — cancelled by printer (${printerName})`,
      actorRole: "PRINTER",
      actorId: String(printerId),
      actorName: printerName,
    };

    const historyEntry = {
      time: now,
      mode: "AUTO",
      selectedPrinterId: null,
      selectedPrinterName: null,
      customerRegion: null,
      customerState: null,
      candidatesConsidered: 0,
      candidatesSameRegion: 0,
      reason: `Cancelled by printer ${printerName}${cancelReason ? `: ${cancelReason}` : ""}`,
      tookMs: 0,
    };

    const setFields: Record<string, any> = {
      status: "PENDING",
      returnedAt: now,
      cancelledByPrinterId: new mongoose.Types.ObjectId(String(printerId)),
      cancelledByPrinterName: printerName,
      updatedAt: now,   // updateOne() skips Mongoose timestamps middleware; set explicitly
    };
    if (cancelReason) setFields.rejectionReason = cancelReason;

    // Use a direct MongoDB updateOne so that:
    //   $unset  — atomically removes the assignedPrinter field (doc.save() with null is unreliable for ObjectId refs)
    //   $set    — writes status, returnedAt, cancelledByPrinterName in one round-trip
    //   $push   — appends audit entries without re-loading the full arrays
    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      {
        $set: setFields,
        $unset: { assignedPrinter: "" },
        $push: {
          statusTimeline: timelineEntry,
          assignmentHistory: historyEntry,
        },
      }
    );

    console.log(
      `[REASSIGN] Printer "${printerName}" released order ${id} (${displayId}) → PENDING, assignedPrinter cleared` +
        (cancelReason ? ` — reason: ${cancelReason}` : "")
    );

    // Releasing the job frees one of the cancelling printer's slots — auto-reopen
    // them if they were paused because they were at capacity.
    syncPartnerCapacitySafe(String(printerId));

    // Fire the customer-facing SSE event so their order page updates immediately
    publishOrderEvent(id, "order.status.changed", {
      orderId: id,
      status: "PENDING",
      from: current,
      to: "PENDING",
      updatedAt: now,
      lastTimelineEntry: timelineEntry,
    });

    // Notify all admins — persists in notification feed AND pushes via SSE
    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: "Job returned to admin queue",
      message: `Order #${displayId} was cancelled by ${printerName} and returned to the queue.${cancelReason ? ` Reason: ${cancelReason}` : ""}`,
      meta: {
        orderId: id,
        displayId,
        printerId: String(printerId),
        printerName,
        cancelledAt: now.toISOString(),
        cancelReason: cancelReason || null,
        type: "printer_cancelled",
      },
    }).catch(() => {});

    // Instant SSE push to every connected admin browser tab — triggers live orders-list refresh
    broadcastToAllAdmins("order.returned_to_queue", {
      orderId: id,
      displayId,
      printerId: String(printerId),
      printerName,
      cancelledAt: now.toISOString(),
      cancelReason: cancelReason || null,
    });

    // Notify the cancelling printer
    notifyPrinter({
      printerId: String(printerId),
      category: "jobs",
      priority: "medium",
      title: "Job returned to queue",
      message: `Order #${displayId} has been released and returned to the admin queue.`,
      meta: { orderId: id, status: "PENDING" },
      settingsKey: "orderUpdates",
    }).catch(() => {});

    // Attempt auto-reassignment — fire and forget; the order is already in the queue either way
    autoAssignOrder(id)
      .then((result) => {
        if (result.assigned) {
          console.log(`[REASSIGN] SUCCESS orderId=${id} → printer="${(result as any).printerName}"`);
        } else {
          console.log(`[REASSIGN] NO_MATCH orderId=${id} reason="${result.reason}" — stays in admin queue`);
        }
      })
      .catch((err: any) => {
        console.error(`[REASSIGN] ERROR orderId=${id}: ${err?.message}`);
      });

    res.json({ cancelled: true, id, status: "PENDING", reassigning: true });
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
      "In Progress - Printing": ["PROCESSING", "PRINTING"],
      "Print Shipping Label": ["QUALITY_CHECK"],
      "Order Shipped": ["SHIPPED"],
      "Completed": ["COMPLETED"],
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
      status: { $nin: ["CANCELLED", "REJECTED"] },
      createdAt: { $gte: startDate }
    }).select("items pricing status createdAt").lean();

    let revenue = 0;
    let paidOut = 0;
    let pending = 0;

    const dailyRevenue: { [key: string]: number } = {};

    orders.forEach(order => {
      const amount = calcEarning(order);
      revenue += amount;

      if (["COMPLETED", "SHIPPED"].includes(String(order.status))) {
        paidOut += amount;
      } else {
        pending += amount;
      }

      const dateKey = new Date(order.createdAt).toISOString().split("T")[0];
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
    const { range = "all", status } = req.query;

    const query: any = { assignedPrinter: printerId };
    const now = new Date();
    if (range === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      query.updatedAt = { $gte: start };
    } else if (range === "7d") {
      query.updatedAt = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    } else if (range === "30d") {
      query.updatedAt = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    }

    if (status === "Paid") {
      query.status = { $in: ["SHIPPED", "COMPLETED"] };
    } else if (status === "Pending") {
      query.status = { $nin: ["SHIPPED", "COMPLETED", "CANCELLED", "REJECTED"] };
    } else {
      query.status = { $nin: ["CANCELLED", "REJECTED"] };
    }

    const orders = await Order.find(query)
      .select("displayId items pricing status updatedAt customer")
      .sort({ updatedAt: -1 })
      .lean();

    const jobs = orders.map(order => {
      const items: any[] = Array.isArray((order as any).items) ? (order as any).items : [];

      const earning = calcEarning(order);

      const isPaid = ["SHIPPED", "COMPLETED"].includes(String(order.status));

      const firstName = items[0]?.name || items[0]?.type || "Print Job";
      const detailsTitle = items.length > 1 ? `${firstName} +${items.length - 1} more` : firstName;
      const detailsSub = `${items.reduce((s: number, i: any) => s + (i.quantity || 1), 0)} item(s)`;

      return {
        id: (order as any).displayId || String((order as any)._id),
        customer: `${(order as any).customer?.firstName || ""} ${(order as any).customer?.lastName || ""}`.trim() || "—",
        details: { title: detailsTitle, sub: detailsSub },
        earning: Number(earning.toFixed(2)),
        completed: new Date((order as any).updatedAt).toISOString().split("T")[0],
        status: isPaid ? "Paid" : "Pending",
      };
    });

    res.json({ jobs });
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

    // Real-time job count
    const totalJobs = await Order.countDocuments({ assignedPrinter: printerId });

    // Fallback for address synchronization
    const businessAddress: any = user.businessAddress?.street 
      ? user.businessAddress 
      : (user.defaultShippingAddress || {});

    res.json({
      name: user.name,
      businessName: user.companyName || user.name,
      email: user.email,
      phone: user.phone || "N/A",
      website: user.website || "N/A",
      avatarUrl: user.avatarUrl,
      regions: user.regions || [],
      detectedRegion: (user as any).detectedRegion ?? null,
      status: user.status || "Active",
      availabilityStatus: (user as any).availabilityStatus ?? "open",
      memberSince: user.createdAt,
      totalJobs,
      verificationStatus: user.verificationStatus || {
        email: false,
        phone: false,
        business: false,
        document: false
      },
      businessDetails: user.businessDetails || {},
      businessAddress: {
        street: businessAddress.street || "",
        city: businessAddress.city || "",
        state: businessAddress.state || "",
        postalCode: businessAddress.postalCode || "",
        country: businessAddress.country || "",
        verified: (businessAddress as any).verified || false
      },
      certifications: user.certifications || [],
      badges: user.badges || [],
      performance: user.performance || {
        completionRate: 0,
        responseTime: 0,
        customerRating: user.rating || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updatePrinterProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { 
      name,
      businessName, 
      phone, 
      website, 
      businessDetails, 
      businessAddress,
      certifications 
    } = req.body;

    const user = await User.findById(printerId);

    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (name) user.name = name;
    if (businessName) user.companyName = businessName;
    if (phone) user.phone = phone;
    if (website) user.website = website;
    
    if (businessDetails) {
      user.businessDetails = { ...user.businessDetails, ...businessDetails };
    }
    
    if (businessAddress) {
      // Merge new fields onto the existing address first
      const merged = { ...(user.businessAddress as any || {}), ...businessAddress };
      user.businessAddress = merged;

      // Re-geocode and recalculate region whenever the address changes
      try {
        const geocoded = await geocodeAddress({
          street:  merged.street,
          city:    merged.city,
          state:   merged.state,
          zip:     merged.postalCode,
        });

        if (geocoded) {
          user.businessAddress = {
            street:      geocoded.street     || merged.street,
            city:        geocoded.city       || merged.city,
            state:       geocoded.state      || merged.state,
            postalCode:  geocoded.zip        || merged.postalCode,
            country:     merged.country,
            verified:    merged.verified ?? false,
            coordinates: { lat: geocoded.lat, lng: geocoded.lng },
          } as any;

          const newRegion =
            normalizeRegion(getRegionFromState(geocoded.state)) ??
            getRegionFromCoords(geocoded.lat, geocoded.lng);
          user.regions = [newRegion];
          (user as any).detectedRegion = newRegion;

          console.log(
            `[region-assign] role=PRINTER id=${user.id} state=${geocoded.state} ` +
            `region=${newRegion} geocoded=true (profile update)`
          );
        } else {
          // Fallback: derive from state code
          const fallbackRegion = getRegionFromState(merged.state);
          if (fallbackRegion) {
            user.regions = [fallbackRegion];
            (user as any).detectedRegion = fallbackRegion;
          }
          console.log(
            `[region-assign] role=PRINTER id=${user.id} state=${merged.state} ` +
            `region=${fallbackRegion} geocoded=false (profile update fallback)`
          );
        }
      } catch (geoErr) {
        console.error("[geocoding] profile update geocoding error:", geoErr);
        // Keep existing region on error — don't overwrite with a bad value
      }
    }

    if (certifications) {
      user.certifications = certifications;
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      profile: {
        name: user.name,
        businessName: user.companyName || user.name,
        phone: user.phone || "N/A",
        website: user.website || "N/A",
        businessDetails: user.businessDetails,
        businessAddress: user.businessAddress,
        certifications: user.certifications,
        regions: user.regions || [],
        detectedRegion: (user as any).detectedRegion ?? null,
      }
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
      notifications: {
        email: {
          newJobs:        settings.notifications?.email?.newJobs        ?? true,
          orderUpdates:   settings.notifications?.email?.orderUpdates   ?? true,
          payoutAlerts:   settings.notifications?.email?.payoutAlerts   ?? true,
          accountUpdates: settings.notifications?.email?.accountUpdates ?? true,
          systemAlerts:   settings.notifications?.email?.systemAlerts   ?? true,
        },
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

    deepMerge(user.settings, updateData);

    user.markModified("settings");
    await user.save();

    const settings = user.settings || {};
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
      notifications: {
        email: {
          newJobs:        settings.notifications?.email?.newJobs        ?? true,
          orderUpdates:   settings.notifications?.email?.orderUpdates   ?? true,
          payoutAlerts:   settings.notifications?.email?.payoutAlerts   ?? true,
          accountUpdates: settings.notifications?.email?.accountUpdates ?? true,
          systemAlerts:   settings.notifications?.email?.systemAlerts   ?? true,
        },
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

// ─── Email Verification ───────────────────────────────────────────────────────

export const requestEmailVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const user = await User.findById(printerId);
    if (!user) { const e = new Error("Printer not found") as any; e.statusCode = 404; throw e; }

    if (user.verificationStatus?.email) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    // Rate limiting: 60-second cooldown between sends
    const COOLDOWN_MS = 60_000;
    if (user.emailVerificationSentAt) {
      const elapsed = Date.now() - user.emailVerificationSentAt.getTime();
      if (elapsed < COOLDOWN_MS) {
        const retryAfterSecs = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          message: `Please wait ${retryAfterSecs}s before requesting another verification email`,
          retryAfterSecs,
        });
      }
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    user.emailVerificationTokenHash = tokenHash;
    user.emailVerificationExpiresAt = expiresAt;
    user.emailVerificationSentAt = new Date();
    await user.save();

    const { sendEmail } = await import("../services/email.service.js");
    const verifyUrl = `${env.printerAppUrl}/verify-email?token=${rawToken}`;
    const displayName = user.companyName || user.name || "Printer";

    await sendEmail({
      to: user.email,
      subject: "Verify your email address – Space Transfers",
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                <tr><td style="background:linear-gradient(135deg,#2563EB,#1D4ED8);padding:32px 40px;">
                  <p style="margin:0;color:#fff;font-size:22px;font-weight:700;">Space Transfers</p>
                  <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Printer Partner Network</p>
                </td></tr>
                <tr><td style="padding:40px;">
                  <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">Verify your email address</p>
                  <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">Hi ${displayName}, click the button below to verify your email address. This link expires in 24 hours.</p>
                  <a href="${verifyUrl}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Verify Email Address</a>
                  <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or copy this link: <a href="${verifyUrl}" style="color:#2563EB;">${verifyUrl}</a></p>
                  <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">If you didn't request this, you can safely ignore this email.</p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `,
    });

    return res.json({
      sent: true,
      message: "Verification email sent",
      nextAllowedAt: new Date(user.emailVerificationSentAt.getTime() + COOLDOWN_MS).toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

// ─── Printer Notifications ────────────────────────────────────────────────────

export const streamPrinterNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    addPrinterNotificationClient(printerId, res);

    const interval = setInterval(() => {
      try { res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`); }
      catch { clearInterval(interval); }
    }, 25_000);

    req.on("close", () => {
      clearInterval(interval);
      removePrinterNotificationClient(printerId, res);
    });
  } catch (error) { next(error); }
};

export const listPrinterNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    const { status, category, priority, q, limit = "30", cursor } = req.query;
    const pageSize = Math.max(1, Math.min(100, parseInt(String(limit), 10) || 30));

    const query: any = { printerId: new mongoose.Types.ObjectId(printerId) };

    if (status === "unread") query.readAt = null;
    if (typeof category === "string" && ["jobs", "orders", "system"].includes(category)) {
      query.category = category;
    }
    if (typeof priority === "string" && ["high", "medium", "low"].includes(priority)) {
      query.priority = priority;
    }
    if (typeof q === "string" && q.trim()) {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ title: re }, { message: re }];
    }
    if (typeof cursor === "string" && cursor.includes("_")) {
      const [createdAtMsRaw, idRaw] = cursor.split("_");
      const createdAtMs = Number(createdAtMsRaw);
      if (Number.isFinite(createdAtMs) && mongoose.Types.ObjectId.isValid(idRaw)) {
        query.$or = [
          { createdAt: { $lt: new Date(createdAtMs) } },
          { createdAt: new Date(createdAtMs), _id: { $lt: new mongoose.Types.ObjectId(idRaw) } },
        ];
      }
    }

    const docs = await PrinterNotification.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasNextPage = docs.length > pageSize;
    const results = hasNextPage ? docs.slice(0, pageSize) : docs;
    const nextCursor = hasNextPage
      ? `${new Date(results[results.length - 1].createdAt).getTime()}_${String(results[results.length - 1]._id)}`
      : null;

    const unreadCount = await PrinterNotification.countDocuments({
      printerId: new mongoose.Types.ObjectId(printerId),
      readAt: null,
    });

    res.status(200).json({
      notifications: results.map((n: any) => ({
        id: String(n._id),
        category: n.category,
        priority: n.priority,
        title: n.title,
        message: n.message,
        readAt: n.readAt || null,
        createdAt: n.createdAt,
      })),
      unreadCount,
      nextCursor,
    });
  } catch (error) { next(error); }
};

export const setPrinterNotificationRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    const notificationId = String((req as any).params?.id || "");
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      const e = new Error("Invalid notification id") as any; e.statusCode = 400; throw e;
    }

    const read = req.body?.read !== undefined ? Boolean(req.body.read) : true;
    const readAt = read ? new Date() : null;

    const updated = await PrinterNotification.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(notificationId), printerId: new mongoose.Types.ObjectId(printerId) },
      { $set: { readAt } },
      { new: true }
    ).lean();

    if (!updated) {
      const e = new Error("Notification not found") as any; e.statusCode = 404; throw e;
    }

    publishPrinterNotificationEvent(printerId, "notification.updated", {
      id: String(updated._id),
      readAt: updated.readAt || null,
    });

    res.status(200).json({ updated: true, id: String(updated._id), readAt: updated.readAt || null });
  } catch (error) { next(error); }
};

export const markAllPrinterNotificationsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    const now = new Date();
    await PrinterNotification.updateMany(
      { printerId: new mongoose.Types.ObjectId(printerId), readAt: null },
      { $set: { readAt: now } }
    );

    publishPrinterNotificationEvent(printerId, "notification.bulk_read", { readAt: now });
    res.status(200).json({ updated: true });
  } catch (error) { next(error); }
};

export const getAvailabilityStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    // Self-heal on read: reconcile the partner's availability with their current
    // load. This guarantees a capacity-paused partner whose active job count has
    // dropped below the limit (or to zero) is auto-reopened when the dashboard
    // loads — even if a status-transition hook was somehow missed. It never
    // reopens a manually-paused/stopped partner.
    const sync = await syncPartnerCapacity(String(printerId));
    if (sync) {
      return res.json({
        availabilityStatus: sync.availabilityStatus,
        capacityLocked: sync.capacityLocked,
        activeJobs: sync.activeJobs,
        maxJobs: sync.maxJobs,
      });
    }

    // Fallback (e.g. the user isn't a printer): report the raw stored status.
    const user = await User.findById(printerId).select("availabilityStatus").lean();
    if (!user) { const e = new Error("Printer not found") as any; e.statusCode = 404; throw e; }
    res.json({
      availabilityStatus: (user as any).availabilityStatus ?? "open",
      capacityLocked: false,
      activeJobs: 0,
      maxJobs: null,
    });
  } catch (error) { next(error); }
};

export const updateAvailabilityStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    const { status } = req.body as { status?: string };
    const valid = ["open", "paused", "stopped"] as const;
    if (!status || !valid.includes(status as any)) {
      const e = new Error("status must be one of: open, paused, stopped") as any;
      e.statusCode = 400;
      throw e;
    }

    const user = await User.findById(printerId).select("settings.jobCapacity capacityPaused").lean();
    if (!user) { const e = new Error("Printer not found") as any; e.statusCode = 404; throw e; }

    const settings = await getAssignmentSettings();
    const maxJobs = getEffectiveMaxConcurrent(user as any, settings);
    const activeJobs = await countActiveJobs(String(printerId));
    const atCapacity = maxJobs != null && activeJobs >= maxJobs;

    // Block manually switching back to Open while at maximum capacity. A 409 keeps
    // the session alive and surfaces a clear reason to the printer.
    if (status === "open" && atCapacity) {
      return res.status(409).json({
        code: "AT_MAX_CAPACITY",
        message:
          `You're at your maximum of ${maxJobs} active ${maxJobs === 1 ? "job" : "jobs"}. ` +
          `You'll be set back to Open automatically once your active job count drops below ${maxJobs}.`,
        availabilityStatus: "paused",
        capacityLocked: true,
        activeJobs,
        maxJobs,
      });
    }

    // A manual status change is an explicit override, so clear the capacity-pause
    // flag — the system won't later auto-reopen a partner who paused themselves.
    await User.updateOne(
      { _id: new mongoose.Types.ObjectId(printerId) },
      { $set: { availabilityStatus: status, capacityPaused: false } }
    );

    // Keep the admin dashboard's partner list in sync in real time.
    broadcastToAllAdmins("partner.availability_changed", {
      partnerId: String(printerId),
      availabilityStatus: status,
      capacityLocked: false,
      activeJobs,
      maxJobs,
    });

    res.json({ availabilityStatus: status, capacityLocked: false, activeJobs, maxJobs });
  } catch (error) { next(error); }
};
