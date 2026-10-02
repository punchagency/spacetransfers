import { Request, Response, NextFunction } from "express";
import { describeTimelineMessage, statusChangeMessage } from "../utils/orderStatusLabels.js";
import { computeOrderFinancials } from "../services/orderFinancials.service.js";
import { recordMissingProcessingFee } from "../services/paymentVerification.service.js";
import { formatSheetSize, orderChargeLines } from "../utils/orderPresentation.js";
import { orderSheets, pickOrderSheet, sheetContents, sheetSummaries } from "../utils/orderSheets.js";
import { Asset } from "../models/asset.model.js";
import { apiFileUrl, resolveApiFile } from "../utils/publicApiBase.js";
import { rollWidthError } from "../services/pricing.service.js";
import { resolveOrderPriorityInput, resolveOrderStatusInput } from "../utils/orderStatusInput.js";
import {
  getRegionFromState,
  normalizeRegion,
  resolveOrderRegion,
  resolvePartnerRegion,
  resolveRegionInfo
} from "../utils/region.js";
import { sendEmail } from "../services/email.service.js";
import mongoose from "mongoose";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { renderInvoicePdf } from "../services/invoicePdf.service.js";
import { Order } from "../models/order.model.js";
import { User, UserRoles, IUser } from "../models/user.model.js";
import { Settings } from "../models/settings.model.js";
import { storeArtwork } from "../services/storage.service.js";
import { computePartnerPerformance } from "../services/partnerPerformance.service.js";
import { LoginActivity } from "../models/loginActivity.model.js";
import { Design } from "../models/design.model.js";
import { AdminNotification } from "../models/adminNotification.model.js";
import { addAdminNotificationClient, publishAdminNotificationEvent, removeAdminNotificationClient } from "../services/adminNotificationsHub.js";
import { notifyAllAdmins, createAdminNotification } from "../services/adminNotifications.service.js";
import { notifyPrinter } from "../services/printerNotifications.service.js";
import {
  canDerivePartnerEarning,
  isPartnerEarningRealized,
} from "../services/partnerEarnings.service.js";
import {
  DEFAULT_GLOBAL_PRICING,
  getPartnerPayRate,
  normalizeGlobalPricing,
} from "../services/pricing.service.js";
import {
  syncPartnerCapacitySafe,
  getAssignmentSettings,
  normalizeSlaSettings,
  getEffectiveMaxConcurrent,
  countActiveJobs,
  isAtCapacity,
} from "../services/partnerCapacity.service.js";
import { exportGangsheetPng24,
    orderSheetWidthIn } from "../services/gangsheetExport.service.js";
import { env } from "../config/env.js";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";
import { isValidEmail, isValidPhone, resolveAddress } from "../utils/accountFields.js";
import { changePartnerStatus } from "../services/partnerStatus.service.js";
import { changePartnerAvailability } from "../services/partnerAvailability.service.js";
import { computeAssignmentDeadlineFor } from "../utils/assignmentDeadline.js";

interface CustomError extends Error {
  statusCode?: number;
}

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
        profitsRealized: isPartnerEarningRealized(order),
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

export const getGlobalPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await Settings.findOne({ key: "global_pricing" });

    if (!settings) {
      return res.status(200).json(DEFAULT_GLOBAL_PRICING);
    }

    // Normalised, not raw: a document saved before a field existed must still
    // come back with that field, or the console would render it blank and then
    // save the blank over the working default.
    res.status(200).json(normalizeGlobalPricing(settings.value));
  } catch (error) {
    next(error);
  }
};

export const updateGlobalPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body && req.body.sheetWidthIn !== undefined) {
      const problem = rollWidthError(req.body.sheetWidthIn);
      if (problem) {
        const error = new Error(problem) as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    const existing = await Settings.findOne({ key: "global_pricing" }).lean();
    const merged = normalizeGlobalPricing({
      ...((existing as any)?.value || {}),
      ...req.body,
    });

    const settings = await Settings.findOneAndUpdate(
      { key: "global_pricing" },
      { $set: { value: merged } },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json(settings?.value);
  } catch (error) {
    next(error);
  }
};

export const streamAdminNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    addAdminNotificationClient(adminId, res);

    const interval = setInterval(() => {
      try {
        res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
      } catch {
        clearInterval(interval);
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(interval);
      removeAdminNotificationClient(adminId, res);
    });
  } catch (error) {
    next(error);
  }
};

export const listAdminNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const { status, category, priority, q, limit = "30", cursor } = req.query;
    const pageSize = Math.max(1, Math.min(100, parseInt(String(limit), 10) || 30));

    const query: any = { adminId: new mongoose.Types.ObjectId(adminId) };

    if (status === "unread") query.readAt = null;
    if (typeof category === "string" && ["orders", "partners", "system"].includes(category)) {
      query.category = category;
    }
    if (typeof priority === "string" && ["high", "medium", "low"].includes(priority)) {
      query.priority = priority;
    }
    // Both the text search and the pagination cursor are $or clauses. Assigning
    // each to `query.$or` meant the cursor silently overwrote the search, so
    // paging past the first page of a filtered list returned unfiltered rows.
    // They are combined under $and so both always apply.
    const conditions: any[] = [];

    if (typeof q === "string" && q.trim()) {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      conditions.push({ $or: [{ title: re }, { message: re }] });
    }

    if (typeof cursor === "string" && cursor.includes("_")) {
      const [createdAtMsRaw, idRaw] = cursor.split("_");
      const createdAtMs = Number(createdAtMsRaw);
      if (Number.isFinite(createdAtMs) && mongoose.Types.ObjectId.isValid(idRaw)) {
        conditions.push({
          $or: [
            { createdAt: { $lt: new Date(createdAtMs) } },
            { createdAt: new Date(createdAtMs), _id: { $lt: new mongoose.Types.ObjectId(idRaw) } }
          ]
        });
      }
    }

    if (conditions.length) query.$and = conditions;

    const docs = await AdminNotification.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasNextPage = docs.length > pageSize;
    const results = hasNextPage ? docs.slice(0, pageSize) : docs;
    const nextCursor = hasNextPage
      ? `${new Date(results[results.length - 1].createdAt).getTime()}_${String(results[results.length - 1]._id)}`
      : null;

    const unreadCount = await AdminNotification.countDocuments({
      adminId: new mongoose.Types.ObjectId(adminId),
      readAt: null
    });

    res.status(200).json({
      notifications: results.map((n: any) => ({
        id: String(n._id),
        category: n.category,
        priority: n.priority,
        title: n.title,
        message: n.message,
        // Carries orderId / partnerId, so a notification can link to the thing
        // it is about. It was populated at every call site and then dropped
        // here, which made every notification a dead end.
        meta: n.meta ?? null,
        readAt: n.readAt || null,
        createdAt: n.createdAt
      })),
      unreadCount,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const setAdminNotificationRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const notificationIdRaw: any = (req as any).params?.id;
    const notificationId =
      Array.isArray(notificationIdRaw) ? String(notificationIdRaw[0] || "") : String(notificationIdRaw || "");
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      const error = new Error("Invalid notification id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const read = req.body?.read !== undefined ? Boolean(req.body.read) : true;
    const readAt = read ? new Date() : null;

    const updated = await AdminNotification.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(notificationId), adminId: new mongoose.Types.ObjectId(adminId) },
      { $set: { readAt } },
      { new: true }
    ).lean();

    if (!updated) {
      const error = new Error("Notification not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    publishAdminNotificationEvent(adminId, "notification.updated", {
      id: String(updated._id),
      readAt: updated.readAt || null
    });

    res.status(200).json({ updated: true, id: String(updated._id), readAt: updated.readAt || null });
  } catch (error) {
    next(error);
  }
};

export const markAllAdminNotificationsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const now = new Date();
    await AdminNotification.updateMany(
      { adminId: new mongoose.Types.ObjectId(adminId), readAt: null },
      { $set: { readAt: now } }
    );

    publishAdminNotificationEvent(adminId, "notification.bulk_read", { readAt: now });

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const getAdminSecuritySettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId).select("settings.security updatedAt");

    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const security = admin.settings?.security || {};

    res.status(200).json({
       lastPasswordChange: security.lastPasswordChange || admin.updatedAt || new Date()
     });
   } catch (error) {
     next(error);
   }
 };
 
 export const getAdminLoginActivity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    // Server-side pagination. pageSize is clamped to [1, 50]; the UI offers
    // 10 / 25 / 50. `limit` is still accepted as an alias for backwards compat.
    const pageSize = Math.max(1, Math.min(50, parseInt(String(req.query.pageSize ?? req.query.limit ?? "10"), 10) || 10));
    const requestedPage = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);

    const filter = { userId: new mongoose.Types.ObjectId(adminId) };
    const total = await LoginActivity.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    // Clamp the page to the valid range so an out-of-bounds request (e.g. after
    // the record count shrinks) still returns the last available page.
    const page = Math.min(requestedPage, totalPages);

    const activity = await LoginActivity.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    res.status(200).json({
      activity: activity.map((a: any) => ({
        id: String(a._id),
        device: a.device || "Unknown device",
        ip: a.ip || "Unknown",
        location: a.location || "Unknown",
        status: a.status === "failed" ? "Failed" : "Success",
        time: a.createdAt
      })),
      total,
      page,
      pageSize,
      totalPages
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId).select("name email phone avatarUrl");

    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      name: admin.name,
      email: admin.email,
      phone: admin.phone || null,
      avatarUrl: admin.avatarUrl || null,
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const { name, email, phone, avatarUrl } = req.body;

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN });
    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    let didUpdate = false;

    if (name !== undefined) {
      admin.name = String(name);
      didUpdate = true;
    }
    if (email !== undefined) {
      const nextEmail = String(email).toLowerCase().trim();
      if (!nextEmail) {
        const error = new Error("email is required") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      const existing = await User.findOne({ email: nextEmail, role: UserRoles.ADMIN, _id: { $ne: admin._id } }).select("_id");
      if (existing) {
        const error = new Error("Email already in use") as CustomError;
        error.statusCode = 409;
        throw error;
      }
      admin.email = nextEmail;
      didUpdate = true;
    }
    if (phone !== undefined) {
      admin.phone = phone === null ? undefined : String(phone);
      didUpdate = true;
    }
    if (avatarUrl !== undefined) {
      // Images are uploaded via POST /admin/profile/upload and stored on
      // storage. Accepting a data: URL here would put the whole image back
      // on the user document, which `authenticate` reads on every request.
      if (typeof avatarUrl === "string" && avatarUrl.startsWith("data:")) {
        const error = new Error("Upload images via /admin/profile/upload — an inline data URL cannot be stored.") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      admin.avatarUrl = avatarUrl === null ? null : String(avatarUrl);
      didUpdate = true;
    }

    if (!didUpdate) {
      const error = new Error("No update data provided") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    await admin.save();

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const uploadAdminAvatar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const file = req.file;

    if (!file) {
      const error = new Error("No file uploaded") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN });
    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const optimized = await sharp(file.buffer)
      .resize(400, 400, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();

    const { url } = await storeArtwork(optimized, "space-transfers/avatars");
    admin.avatarUrl = url;
    await admin.save();

    res.json({ avatarUrl: url });
  } catch (error) {
    next(error);
  }
};

export const updateAdminPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    if (typeof currentPassword !== "string" || !currentPassword.trim()) {
      const error = new Error("currentPassword is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      const error = new Error("newPassword must be at least 8 characters") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN }).select("passwordHash settings updatedAt");
    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!admin.passwordHash) {
      const error = new Error("Admin account has no password set") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!ok) {
      // A wrong *submitted* current password is a credential re-check failure on
      // an already-authenticated request — NOT a bad session token. It must not
      // be 401, or the client treats it as an expired token and logs the user
      // out. 403 keeps the session alive and surfaces a descriptive message.
      const error = new Error("Current password is incorrect") as CustomError;
      error.statusCode = 403;
      throw error;
    }

    // The new password must actually be a change. currentPassword was just
    // verified against the stored hash, so a plain equality check is sufficient
    // to detect reuse.
    if (newPassword === currentPassword) {
      const error = new Error("New password must be different from your current password") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    if (!admin.settings) {
      admin.settings = {
        pricing: { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } },
        security: {}
      };
    }
    if (!admin.settings.security) admin.settings.security = {};
    admin.settings.security.lastPasswordChange = new Date();
    admin.markModified("settings.security");
    await admin.save();

    // Send a notification that the password was changed.
    createAdminNotification({
      adminId: String(adminId),
      category: "system",
      priority: "medium",
      title: "Password changed",
      message: "Your admin password was successfully updated.",
      meta: { type: "password_changed", changedAt: new Date() }
    }).catch(() => {});

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      status,
      partnerId,
      priority,
      search,
      cursor,
      limit = "20"
    } = req.query;

    const query: any = {};
    // Extra compound filters that can't be merged directly into query
    const extraFilters: any[] = [];

    if (status) {
      // Shared with updateOrderStatus, so the value that filters a list and the
      // value that writes a status can never disagree again.
      query.status = resolveOrderStatusInput(status) ?? String(status).toUpperCase();
    }

    if (priority) {
      const resolved = resolveOrderPriorityInput(priority);
      if (resolved === "URGENT") query.priority = "URGENT";
      // NORMAL must also match orders placed before priority existed, which
      // carry no field at all — matching only "NORMAL" would hide them.
      else if (resolved === "NORMAL") query.priority = { $ne: "URGENT" };
    }

    if (partnerId) {
      query.assignedPrinter = partnerId;
    }

    if (search) {
      const searchRegex = new RegExp((search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const searchOr: any[] = [
        { "customer.firstName": searchRegex },
        { "customer.lastName": searchRegex },
        { "customer.email": searchRegex },
        // The human-readable id (DTF-0242) is what the UI shows everywhere, so
        // it is the first thing anyone types into the box. Searching only the
        // raw ObjectId meant pasting a visible order number returned nothing.
        { displayId: searchRegex }
      ];
      if (mongoose.Types.ObjectId.isValid(search as string)) {
        searchOr.push({ _id: search as string });
      }
      extraFilters.push({ $or: searchOr });
    }

    /*
     * Unassigned orders come first, then everything else, each block ordered
     * most-recently-touched first.
     *
     * An unassigned order is the only kind that needs an admin to act, so it is
     * what the table should open on. Sorting the fetched page in the browser
     * would not achieve it: with keyset pagination an unassigned order sitting
     * on page three stays on page three, which is exactly where nobody looks.
     *
     * MongoDB cannot sort a `find()` on a computed flag, and sorting on
     * `assignedPrinter` itself would group the assigned block by partner
     * ObjectId instead of by recency. So the two blocks are paged explicitly —
     * same filters, same populate — and the cursor records which block it left
     * off in.
     *
     * Cursor: "${block}_${updatedAt.getTime()}_${_id}", block being "u"
     * (unassigned) or "a" (assigned). updatedAt is bumped on every write, so it
     * remains the reliable within-block sort key.
     */
    const UNASSIGNED: any = { assignedPrinter: null };
    const ASSIGNED: any = { assignedPrinter: { $ne: null } };

    let cursorBlock: "u" | "a" = "u";
    let cursorFilter: any = null;

    if (cursor && typeof cursor === "string" && cursor.includes("_")) {
      const parts = cursor.split("_");
      const [blockRaw, tsRaw, idRaw] =
        parts.length >= 3 ? parts : ["a", parts[0], parts[1]];
      const cursorTs = Number(tsRaw);
      if (
        (blockRaw === "u" || blockRaw === "a") &&
        Number.isFinite(cursorTs) &&
        mongoose.Types.ObjectId.isValid(idRaw)
      ) {
        cursorBlock = blockRaw;
        const cursorDate = new Date(cursorTs);
        const cursorObjId = new mongoose.Types.ObjectId(idRaw);
        cursorFilter = {
          $or: [
            { updatedAt: { $lt: cursorDate } },
            { updatedAt: cursorDate, _id: { $lt: cursorObjId } },
          ],
        };
      }
    }

    const pageSize = parseInt(limit as string);

    const buildQuery = (block: any, withCursor: boolean) => {
      const filters = [...extraFilters, block];
      if (withCursor && cursorFilter) filters.push(cursorFilter);
      return { ...query, $and: filters };
    };

    const fetchBlock = (block: any, withCursor: boolean, take: number) =>
      Order.find(buildQuery(block, withCursor))
        .select("-items.artboardItems")
        .sort({ updatedAt: -1, _id: -1 })
        .limit(take)
        .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions settings.pricing defaultShippingAddress businessAddress")
        .lean();

    // One extra row tells us whether another page exists, without a count().
    let orders: any[] = [];

    if (cursorBlock === "u") {
      orders = await fetchBlock(UNASSIGNED, true, pageSize + 1);
      if (orders.length <= pageSize) {
        // The unassigned block is exhausted, so top the page up from the start
        // of the assigned block.
        const remaining = pageSize + 1 - orders.length;
        const assigned = await fetchBlock(ASSIGNED, false, remaining);
        if (assigned.length > 0) orders = [...orders, ...assigned];
      }
    } else {
      orders = await fetchBlock(ASSIGNED, true, pageSize + 1);
    }

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    // The block the final returned row belongs to is what the next cursor must
    // continue from — not necessarily the block the request started in.
    const lastRow: any = results[results.length - 1];
    const lastRowBlock: "u" | "a" = lastRow && lastRow.assignedPrinter ? "a" : "u";

    const userIds = Array.from(
      new Set(
        results
          .map((o: any) => (o.user ? String(o.user) : null))
          .filter(Boolean)
      )
    ) as string[];
    const users = userIds.length > 0
      ? await User.find({ _id: { $in: userIds } }).select("regions").lean()
      : [];
    const userRegionMap = new Map<string, string | null>(
      users.map((u: any) => [String(u._id), Array.isArray(u.regions) ? (u.regions[0] || null) : null])
    );

    const partnerPayRate = await getPartnerPayRate();

    const formattedOrders = results.map(order => {
      // Every sheet, not the first one's size for the whole order.
      const sheetList = sheetSummaries(order.items);
      const sheetSize = sheetList.length > 1
        ? `${sheetList.length} sheets`
        : formatSheetSize(sheetList[0]?.widthIn, sheetList[0]?.heightIn) || "N/A";

      // Same source as the dashboard and as real payouts — see
      // calculateOrderFinancials above for why the flat rate was wrong.
      const regionInfo = resolveRegionInfo(order, userRegionMap);
      const profits = computeOrderFinancials(order, partnerPayRate).profit;
  
      return {
        id: order._id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        profits: profits === null ? null : Number(profits.toFixed(2)),
        profitsRealized: isPartnerEarningRealized(order),
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: (order as any).updatedAt ? new Date((order as any).updatedAt).toISOString() : null,
        returnedAt: (order as any).returnedAt ? new Date((order as any).returnedAt).toISOString() : null,
        cancelledByPrinterName: (order as any).cancelledByPrinterName || null,
        isReturnedToQueue: !!(order as any).returnedAt,
        assignedPartnerId: (order.assignedPrinter as any)?._id
          ? String((order.assignedPrinter as any)._id)
          : (order.assignedPrinter ? String(order.assignedPrinter) : null),
        assignedPartner: (order.assignedPrinter as any)?.companyName || null,
        sheetSize,
        isUrgent: order.priority === "URGENT",
        displayId: (order as any).displayId || null,
        region: regionInfo.customerRegion,
        // Surfaced so the orders table can badge a fallback assignment rather
        // than the fact being buried in a timeline message.
        crossRegion: regionInfo.crossRegion
          ? {
              customerRegion: regionInfo.customerRegion,
              assignedRegion: regionInfo.printerRegion,
            }
          : null
      };
    });

    let nextCursor = null;
    if (hasNextPage) {
      const lastOrder = results[results.length - 1];
      const lastUpdatedAt = (lastOrder as any).updatedAt ?? lastOrder.createdAt;
      nextCursor = `${lastRowBlock}_${new Date(lastUpdatedAt).getTime()}_${lastOrder._id}`;
    }

    res.status(200).json({
      orders: formattedOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("settings shipStationWarehouseId")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const settings = partner.settings || {};

    res.status(200).json({
      // autoAccept was missing from this fallback, so a partner with no
      // jobCapacity document came back without it and the toggle defaulted
      // blind.
      jobCapacity: settings.jobCapacity || { maxConcurrent: 0, dailyMax: 0, autoAccept: true },
      // Lives on the user, not in settings — it identifies this partner inside
      // the client's ShipStation account rather than configuring the platform.
      shipStationWarehouseId: (partner as any).shipStationWarehouseId ?? null,
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { jobCapacity, shipStationWarehouseId } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const updateData: any = {};

    if (jobCapacity) {
      if (jobCapacity.maxConcurrent !== undefined) updateData["settings.jobCapacity.maxConcurrent"] = jobCapacity.maxConcurrent;
      if (jobCapacity.dailyMax !== undefined) updateData["settings.jobCapacity.dailyMax"] = jobCapacity.dailyMax;
      /*
       * Auto-accept had no branch at all, so the toggle in the console never
       * saved anything: it moved, reported success, and reverted on reload.
       */
      if (jobCapacity.autoAccept !== undefined) updateData["settings.jobCapacity.autoAccept"] = jobCapacity.autoAccept;
    }

    if (shipStationWarehouseId !== undefined) {
      const raw = shipStationWarehouseId;
      if (raw === null || raw === "") {
        updateData["shipStationWarehouseId"] = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          const error = new Error(
            "ShipStation warehouse ID must be a positive whole number — it is the number in the warehouse's URL",
          ) as CustomError;
          error.statusCode = 400;
          throw error;
        }
        updateData["shipStationWarehouseId"] = n;
      }
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const setOrderTracking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { carrier, trackingNumber, trackingUrl } = req.body;

    if (!carrier || !trackingNumber) {
      const error = new Error("Carrier and trackingNumber are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    order.carrier = carrier;
    order.trackingNumber = trackingNumber;
    order.trackingUrl = trackingUrl;
    order.status = "SHIPPED";

    if (!order.statusTimeline) order.statusTimeline = [];
    order.statusTimeline.push({
      status: "SHIPPED",
      time: new Date(),
      message: `Order shipped via ${carrier}. Tracking: ${trackingNumber}`,
      actorRole: "ADMIN",
      actorId: String(req.user?.id || ""),
      actorName: null
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

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { status } = req.body;

    if (!status) {
      const error = new Error("Status is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // One shared map — see `utils/orderStatusInput`. This and the list filter
    // were separate copies that drifted apart.
    const resolved = resolveOrderStatusInput(status);

    const dbStatus = resolved as any;
    if (!dbStatus) {
      const error = new Error(`Invalid status value: ${status}`) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    order.status = dbStatus;

    if (!order.statusTimeline) order.statusTimeline = [];
    order.statusTimeline.push({
      status: dbStatus,
      time: new Date(),
      message: statusChangeMessage("ADMIN", status),
      actorRole: "ADMIN",
      actorId: String(req.user?.id || ""),
      actorName: null
    });

    await order.save();

    // A terminal status frees a capacity slot; reconcile the partner's availability.
    if (order.assignedPrinter) syncPartnerCapacitySafe(String(order.assignedPrinter));

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "Order status updated",
      message: `Order ${String(order._id)} → ${dbStatus}`,
      meta: { orderId: String(order._id), status: dbStatus }
    }).catch(() => {});

    if (order.assignedPrinter) {
      const labelMap: Record<string, string> = {
        PENDING: "Pending Review",
        PRINTING: "In Progress",
        QUALITY_CHECK: "Ready for Packaging",
        SHIPPED: "Shipped",
        COMPLETED: "Completed",
        CANCELLED: "Cancelled",
      };
      const statusLabel = labelMap[dbStatus] || dbStatus;
      notifyPrinter({
        printerId: String(order.assignedPrinter),
        category: "orders",
        priority: dbStatus === "CANCELLED" ? "high" : "medium",
        title: `Order status changed to ${statusLabel}`,
        message: `Order ${(order as any).displayId || String(order._id)} was updated to ${statusLabel} by admin.`,
        meta: { orderId: String(order._id), status: dbStatus },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }

    res.status(200).json({
      orderId: order._id,
      status: status,
      updatedAt: order.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const assignOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { partnerId, force = false } = req.body;

    if (!partnerId) {
      const error = new Error("partnerId is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerId, role: UserRoles.PRINTER });
    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    // Region check — warn on cross-region unless admin explicitly passes force:true.
    const customerRegion = normalizeRegion(getRegionFromState(order.shippingAddress?.state || "")) || null;
    const printerRegion = normalizeRegion(getRegionFromState((partner.defaultShippingAddress as any)?.state || ""))
      || normalizeRegion(getRegionFromState((partner as any).businessAddress?.state || ""))
      || partner.regions?.[0]
      || null;
    const isCrossRegion = customerRegion && printerRegion && customerRegion !== printerRegion;
    if (isCrossRegion && !force) {
      return res.status(409).json({
        code: "CROSS_REGION_ASSIGNMENT",
        message: `Customer is in ${customerRegion} but printer is in ${printerRegion}. Pass force:true to override.`,
        customerRegion,
        printerRegion,
      });
    }
    if (isCrossRegion) {
      console.warn(
        `[MANUAL_ASSIGN] CROSS-REGION override: order=${order._id} customerRegion=${customerRegion} printerRegion=${printerRegion} admin=${req.user?.email}`
      );
    }

    const previousPartnerId = order.assignedPrinter;
    const isReassignment = previousPartnerId && previousPartnerId.toString() !== partnerId;

    // Capacity guard — a printer at its maximum active job limit cannot receive
    // additional work, whether the assignment is automatic or manual. Enforced
    // here on the backend so it can't be bypassed via direct API calls. Skipped
    // only for a no-op re-assign to the printer who already holds this order
    // (that adds no new load).
    const alreadyHoldsThisOrder = previousPartnerId && String(previousPartnerId) === String(partnerId);
    if (!alreadyHoldsThisOrder) {
      const assignmentSettings = await getAssignmentSettings();
      const effectiveMax = getEffectiveMaxConcurrent(partner as any, assignmentSettings);
      if (effectiveMax != null) {
        const activeCount = await countActiveJobs(String(partnerId));
        if (isAtCapacity(activeCount, effectiveMax)) {
          // Make sure the partner's availability reflects the capacity state.
          syncPartnerCapacitySafe(String(partnerId));
          return res.status(409).json({
            code: "AT_MAX_CAPACITY",
            message:
              "This printer has reached its maximum active job limit and cannot accept additional jobs until one or more active jobs are completed or reassigned.",
            partnerId: String(partnerId),
            activeJobs: activeCount,
            maxJobs: effectiveMax,
          });
        }
      }
    }

    order.assignedPrinter = partnerId;
    // (Re)start the 24h fulfilment clock from this assignment moment. A no-op
    // re-assign to the printer who already holds the order keeps its existing
    // deadline (nothing changed); a first assignment or a hand-off to a different
    // printer resets it — the new printer gets a fresh 24 hours.
    if (!alreadyHoldsThisOrder || !order.assignmentDeadline) {
      const assignedAt = new Date();
      order.assignedAt = assignedAt;
      order.assignmentDeadline = computeAssignmentDeadlineFor(
      assignedAt,
      (order as any).priority,
      (await getAssignmentSettings()).sla.acceptHours,
    );
    }
    // Same rule as auto-assignment: attaching a partner moves PENDING to
    // PROCESSING, and never drags a further-along order backwards.
    if (String(order.status || "").toUpperCase() === "PENDING") {
      order.status = "PROCESSING";
    }

    const message = isReassignment 
      ? `Order reassigned from previous partner to ${partner.companyName || partner.name}`
      : `Order assigned to ${partner.companyName || partner.name}`;

    if (!order.statusTimeline) order.statusTimeline = [];
    order.statusTimeline.push({
      status: String(order.status || "PENDING"),
      time: new Date(),
      message,
      actorRole: "ADMIN",
      actorId: String(req.user?.id || ""),
      actorName: String(req.user?.name || req.user?.email || "") || null
    });

    if (!order.assignmentHistory) order.assignmentHistory = [];
    order.assignmentHistory.push({
      time: new Date(),
      mode: "MANUAL",
      selectedPrinterId: String(partnerId),
      selectedPrinterName: partner.companyName || partner.name,
      customerRegion,
      customerState: order.shippingAddress?.state || null,
      printerRegion,
      crossRegion: Boolean(isCrossRegion),
      forceOverride: Boolean(isCrossRegion && force),
      candidatesConsidered: 0,
      candidatesSameRegion: 0,
      reason: isCrossRegion ? `[CROSS-REGION OVERRIDE] ${message}` : message,
      tookMs: 0
    } as any);

    await order.save();

    // Reconcile capacity: the newly-assigned partner may now be at their max
    // (auto-pause), and on a reassignment the previous partner frees a slot
    // (possible auto-reopen).
    syncPartnerCapacitySafe(String(partnerId));
    if (isReassignment && previousPartnerId) syncPartnerCapacitySafe(String(previousPartnerId));

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "Order assigned",
      message: `Order ${String(order._id)} → ${partner.companyName || partner.name}`,
      meta: { orderId: String(order._id), partnerId: String(partnerId) }
    }).catch(() => {});

    notifyPrinter({
      printerId: String(partnerId),
      category: "jobs",
      priority: order.priority === "URGENT" ? "high" : "medium",
      title: isReassignment ? "Job reassigned to you" : "New job assigned",
      message: `Order ${(order as any).displayId || String(order._id)} has been assigned to you and is ready to start.`,
      meta: { orderId: String(order._id) },
      settingsKey: "newJobs",
    }).catch(() => {});

    console.log(
      `[MANUAL_ASSIGN] order=${order._id} partnerId=${partnerId} partnerName=${partner.companyName || partner.name} ` +
      `priority=${order.priority} customerRegion=${customerRegion} printerRegion=${printerRegion} crossRegion=${Boolean(isCrossRegion)}`
    );

    res.status(200).json({
      orderId: order._id,
      assignedPartnerId: partnerId,
      status: "Pending",
      regionInfo: { customerRegion, printerRegion, crossRegion: Boolean(isCrossRegion) }
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName email regions defaultShippingAddress businessAddress")
      .lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const formattedItems = (order.items || []).map(item => ({
      name: item.name,
      size: formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "Custom",
      quantity: item.quantity,
      price: item.unitPrice,
      subtotal: item.subtotal,
      // The sheet's own picture; the list showed a blank icon for every sheet.
      fileUrl: resolveApiFile(req, (item as any).previewImage) || undefined,
    }));

    const breakdown = computePartnerCostBreakdown({
      items: Array.isArray(order.items) ? order.items : [],
      partnerPricing: await getPartnerPayRate(),
      priority: (order as any).priority,
      adjustments: (order as any)?.pricing?.adjustments || []
    });
    /**
     * Null when there is nothing to derive a cost from — the fourth surface
     * that needed this. An order whose items carry no sheet dimensions has an
     * unknown partner cost, not a zero one, and `customerPaid - 0` reported
     * 100% margin on orders with no cost data at all.
     */
    const costDerivable = canDerivePartnerEarning(order);
    // An order from before fees were recorded gets its Stripe fee now, once.
    await recordMissingProcessingFee(order);
    const money = computeOrderFinancials(order, await getPartnerPayRate());

    const gangsheetOrderItem = (order.items || []).find((it: any) => it?.type === "gangsheet") as any | null;
    const designId = gangsheetOrderItem?.designId || order.items?.[0]?.designId || null;
    let designThumbnail = null;
    let designSize: { widthIn: number; heightIn: number } | null = null;
    let designArtboardItems: any[] | null = null;
    let gangsheetItems: any[] = [];
    const storedArtboardItems = Array.isArray(gangsheetOrderItem?.artboardItems) ? gangsheetOrderItem.artboardItems : null;
    const storedSheetWidthIn =
      typeof gangsheetOrderItem?.sheetWidthIn === "number"
        ? gangsheetOrderItem.sheetWidthIn
        : typeof gangsheetOrderItem?.widthIn === "number"
          ? gangsheetOrderItem.widthIn
          : null;
    const storedSheetHeightIn =
      typeof gangsheetOrderItem?.sheetHeightIn === "number"
        ? gangsheetOrderItem.sheetHeightIn
        : typeof gangsheetOrderItem?.heightIn === "number"
          ? gangsheetOrderItem.heightIn
          : null;

    if (storedArtboardItems && storedSheetWidthIn && storedSheetHeightIn) {
      designArtboardItems = storedArtboardItems;
      designSize = { widthIn: storedSheetWidthIn, heightIn: storedSheetHeightIn };
      designThumbnail = resolveApiFile(req, gangsheetOrderItem?.previewImage);
      gangsheetItems = storedArtboardItems.map((it: any) => {
        const url = it.croppedUrl || it.assetId || null;
        const rawSku = typeof it.assetId === "string" ? it.assetId : "";
        const sku = rawSku ? rawSku.split("/").filter(Boolean).slice(-1)[0] : `ITEM-${it.id}`;
        const baseName = sku ? sku.replace(/\.[a-z0-9]+$/i, "") : `Artwork ${it.id}`;
        return {
          name: baseName || `Artwork ${it.id}`,
          sku,
          quantity: typeof it.copies === "number" ? it.copies : 1,
          size: (typeof it.widthIn === "number" && typeof it.heightIn === "number")
            ? `${it.widthIn.toFixed(2)}\" × ${it.heightIn.toFixed(2)}\"`
            : "N/A",
          color: "N/A",
          customAttributes: {
            linked: Boolean(it.linked),
            autoCrop: it.autoCrop !== false,
            rotation: typeof it.rotation === "number" ? it.rotation : 0
          },
          fileUrl: url
        };
      });
    } else if (designId && /^[0-9a-fA-F]{24}$/.test(designId)) {
      const design = await Design.findById(designId).select("thumbnail size artboardData").lean();
      if (design && design.thumbnail) {
        designThumbnail = design.thumbnail;
      }
      if (design && design.size?.widthIn && design.size?.heightIn) {
        designSize = { widthIn: design.size.widthIn, heightIn: design.size.heightIn };
      }
      if (design && Array.isArray((design as any).artboardData?.items)) {
        const artboardItems = ((design as any).artboardData.items as any[]) || [];
        designArtboardItems = artboardItems;
        gangsheetItems = artboardItems.map((it: any) => {
          const url = it.croppedUrl || it.assetId || null;
          const rawSku = typeof it.assetId === "string" ? it.assetId : "";
          const sku = rawSku ? rawSku.split("/").filter(Boolean).slice(-1)[0] : `ITEM-${it.id}`;
          const baseName = sku ? sku.replace(/\.[a-z0-9]+$/i, "") : `Artwork ${it.id}`;
          return {
            name: baseName || `Artwork ${it.id}`,
            sku,
            quantity: typeof it.copies === "number" ? it.copies : 1,
            size: (typeof it.widthIn === "number" && typeof it.heightIn === "number")
              ? `${it.widthIn.toFixed(2)}\" × ${it.heightIn.toFixed(2)}\"`
              : "N/A",
            color: "N/A",
            customAttributes: {
              linked: Boolean(it.linked),
              autoCrop: it.autoCrop !== false,
              rotation: typeof it.rotation === "number" ? it.rotation : 0
            },
            fileUrl: url
          };
        });
      }
    }

    const regionUser = order.user
      ? await User.findById(order.user).select("regions").lean()
      : null;
    const oneUserRegionMap = new Map<string, string | null>(
      order.user
        ? [[String(order.user), Array.isArray((regionUser as any)?.regions) ? ((regionUser as any).regions[0] || null) : null]]
        : []
    );

    const orderSummary = {
      id: order._id,
      // The canonical human-readable order number, so every surface shows the
      // same identifier instead of deriving its own from the ObjectId.
      displayId: (order as any).displayId || null,
      status: order.status,
      priority: String((order as any).priority || "NORMAL").toUpperCase(),
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
        region: resolveOrderRegion(order, oneUserRegionMap)
      },

      items: formattedItems,

      statusTimeline: (order.statusTimeline || []).map(entry => ({
        status: entry.status,
        time: entry.time,
        // Older entries read "Printer updated status to QUALITY_CHECK".
        message: describeTimelineMessage((entry as any).message),
        actorRole: (entry as any).actorRole || null,
        actorId: (entry as any).actorId || null,
        actorName: (entry as any).actorName ?? null
      })),

      financials: {
        customerPaid: money.customerPaid,
        // What the business does not keep, listed so the profit below adds up.
        tax: money.tax,
        shippingCharged: money.shippingCharged,
        shippingCost: money.shippingCost,
        shippingCostSource: money.shippingCostSource,
        processingFees: money.processingFee,
        /**
         * The rush surcharge, broken out.
         *
         * URGENT adds the partner's `rushPct` to what they are owed — 10% on
         * every seeded partner — and it was folded silently into partnerCost.
         * An admin could raise a payout by a tenth and see only the new total,
         * with nothing on screen saying why.
         */
        rushFee: costDerivable ? Number(breakdown.rushFee.toFixed(2)) : null,
        baseCost: costDerivable ? Number(breakdown.base.toFixed(2)) : null,
        partnerCost: money.partnerCost,
        adminProfit: money.profit,
        // False until the job ships: the partner is not paid before then, so
        // the margin is a forecast — same rule the Orders table uses.
        profitRealized: isPartnerEarningRealized(order),
        unavailableReason: costDerivable
          ? undefined
          : "This order has no sheet dimensions, so no partner cost can be worked out.",
        currency: order.pricing?.currency || "USD"
      },

      assignedPartner: order.assignedPrinter ? {
        id: (order.assignedPrinter as unknown as IUser)._id,
        name: (order.assignedPrinter as unknown as IUser).companyName,
        email: (order.assignedPrinter as unknown as IUser).email
      } : null,

      regionInfo: resolveRegionInfo(order, oneUserRegionMap),

      preview: {
        designId,
        sheetSize: formattedItems[0]?.size || "N/A",
        fileUrl: designThumbnail,
        sheetWidthIn: designSize?.widthIn || null,
        sheetHeightIn: designSize?.heightIn || null,
        artboardItems: designArtboardItems
      }
    };

    // Uploaded file names for every graphic on the order, to label the contents.
    const assetObjectIds = [
      ...new Set(
        orderSheets(order.items).flatMap((sh: any) =>
          (Array.isArray(sh.artboardItems) ? sh.artboardItems : [])
            .map((it: any) => String(it?.assetId || ""))
            .filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id)),
        ),
      ),
    ];
    const assetNames = new Map<string, string>(
      (assetObjectIds.length
        ? await Asset.find({ _id: { $in: assetObjectIds } }).select("originalFilename").lean()
        : []
      )
        .filter((a: any) => a?.originalFilename)
        .map((a: any) => [String(a._id), String(a.originalFilename)]),
    );
    (orderSummary as any).gangsheetItems = designArtboardItems ? sheetContents(designArtboardItems, assetNames) : gangsheetItems;
    /*
     * Every sheet on the order. `preview` and `gangsheetItems` above describe
     * the first only (kept for older screens); a second sheet was invisible to
     * the admin, though the customer paid for it.
     */
    (orderSummary as any).sheets = sheetSummaries(order.items, (v) => resolveApiFile(req, v)).map((summary) => ({
      ...summary,
      sheetSize: formatSheetSize(summary.widthIn, summary.heightIn) || "N/A",
      gangsheetItems: sheetContents(orderSheets(order.items)[summary.index]?.artboardItems, assetNames),
    }));

    res.status(200).json(orderSummary);
  } catch (error) {
    next(error);
  }
};

export const getOrderGangsheetPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const id = Array.isArray(orderId) ? String(orderId[0] || "") : String(orderId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid order id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const requestedResolution = Math.max(72, Math.min(100, parseInt(req.query.resolution as string) || 72));

    // Project only the 8 rendering fields from artboard items — all items, minimal payload.
    const [orderRaw] = await (Order as any).aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      { $project: {
        assignedPrinter: 1,
        items: {
          $map: {
            input: { $ifNull: ["$items", []] },
            as: "item",
            in: {
              type: "$$item.type",
              widthIn: "$$item.widthIn",
              heightIn: "$$item.heightIn",
              sheetWidthIn: "$$item.sheetWidthIn",
              rollWidthIn: "$$item.rollWidthIn",
              sheetHeightIn: "$$item.sheetHeightIn",
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
                    // Flip and the auto-nest layout fields were not projected, so
                    // the admin preview drew mirrored and nested pieces wrongly.
                    flipped: "$$ai.flipped",
                    copies: "$$ai.copies",
                    nestRotation: "$$ai.nestRotation",
                    flowCols: "$$ai.flowCols",
                  },
                },
              },
            },
          },
        },
      }},
    ]);

    if (!orderRaw) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { sheet: gangsheetItem } = pickOrderSheet(orderRaw.items, req.query?.sheet);
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this order") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    /**
     * The roll width this order was built on — see `orderSheetWidthIn`.
     *
     * Never the artwork's bounding width: item `posX` values are absolute
     * against the roll, so a canvas sized to anything else puts every
     * x-coordinate in the wrong place and clips what falls past its edge.
     */
    const sheetWidthIn = orderSheetWidthIn(gangsheetItem);
    const sheetHeightIn = typeof gangsheetItem.sheetHeightIn === "number" && Number.isFinite(gangsheetItem.sheetHeightIn)
      ? gangsheetItem.sheetHeightIn : typeof gangsheetItem.heightIn === "number" && Number.isFinite(gangsheetItem.heightIn)
      ? gangsheetItem.heightIn : 23.5;

    const printerId = String((orderRaw as any).assignedPrinter || "admin");

    // Cap DPI so the canvas never exceeds ~15 Mpx: prevents a single 1200"-sheet
    // preview from allocating a 550+ MB RGBA buffer and exceeding browser image limits.
    const MAX_PREVIEW_PIXELS = 15_000_000;
    const pixelBudgetDPI = Math.floor(
      Math.sqrt(MAX_PREVIEW_PIXELS / Math.max(0.01, sheetWidthIn * sheetHeightIn))
    );
    const resolution = Math.max(10, Math.min(requestedResolution, pixelBudgetDPI));

    const rendered = await exportGangsheetPng24({
      jobId: id,
      printerId,
      sheetWidthIn,
      sheetHeightIn,
      artboardItems,
      dpi: resolution,
      maxComposites: 500, // Cap admin previews to first 500 composites for instant response
      format: "webp",
      useLossyPreview: true, // Use fast lossy WebP for admin preview
    });

    // The API's own address, not APP_URL (the store's) — see utils/publicApiBase.ts.
    const previewDataUrl = apiFileUrl(req, rendered.relativePath);

    res.json({
      previewDataUrl,
      resolutionDPI: rendered.dpi,
      sheetWidthIn,
      sheetHeightIn,
      totalItems: artboardItems.length,
      cacheKey: rendered.cacheKey,
      previewNote: artboardItems.length > 500 ? "Preview shows first 500 items" : undefined,
    });
  } catch (error) {
    next(error);
  }
};

export const exportOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, status } = req.query;

    const query: any = {};
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from as string);
      if (to) query.createdAt.$lte = new Date(to as string);
    }
    if (status) {
      query.status = resolveOrderStatusInput(status) ?? String(status).toUpperCase();
    }

    const filename = `orders-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const columns = ['orderId', 'customer', 'email', 'status', 'total', 'partner', 'sheetSize', 'createdAt', 'completedAt'];
    res.write(columns.join(',') + '\n');

    const cursor = Order.find(query)
      .populate<{ assignedPrinter: IUser }>('assignedPrinter', 'companyName')
      .sort({ createdAt: -1 })
      .cursor();

    for (let order = await cursor.next(); order != null; order = await cursor.next()) {
      const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim();
      const sheetList = sheetSummaries(order.items);
      const sheetSize = sheetList.length > 1
        ? `${sheetList.length} sheets`
        : formatSheetSize(sheetList[0]?.widthIn, sheetList[0]?.heightIn) || 'N/A';
      
      const completedAt = order.status === 'COMPLETED' ? (order.updatedAt || order.createdAt).toISOString() : 'N/A';

      const row = [
        order._id,
        `"${customerName.replace(/"/g, '""')}"`,
        order.customer?.email || 'N/A',
        order.status,
        order.pricing?.total || 0,
        `"${((order.assignedPrinter as unknown as IUser)?.companyName || 'N/A').replace(/"/g, '""')}"`,
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

export const createPartner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      partnerName,
      contactName,
      name,
      companyName,
      email,
      phone,
      regions,
      address,
      status
    } = req.body;

    const resolvedCompanyName = (typeof partnerName === "string" && partnerName.trim())
      || (typeof companyName === "string" && companyName.trim())
      || (typeof name === "string" && name.trim())
      || "";
    const resolvedContactName = (typeof contactName === "string" && contactName.trim())
      || (typeof name === "string" && name.trim())
      || resolvedCompanyName;

    if (!resolvedCompanyName) {
      const error = new Error("partnerName is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (typeof email !== "string" || !email.trim()) {
      const error = new Error("email is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * Name and email are the whole requirement.
     *
     * Everything else — phone, address, service areas — is the
     * partner's own information, and they know it better than whoever is typing
     * the form. They fill it in after they set their password. Nothing can be
     * assigned to them before an admin approves them anyway, which is where
     * completeness is checked.
     */

    /*
     * Scoped to partners. One address may hold an account per role now, so an
     * admin adding a print partner must not be blocked because that person also
     * shops on the store — which is exactly the case an unscoped check refused.
     */
    const existingUser = await User.findOne({ email, role: UserRoles.PRINTER });
    if (existingUser) {
      const error = new Error("Partner with this email already exists") as CustomError;
      error.statusCode = 409;
      throw error;
    }

    const unusableSecret = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(unusableSecret, 10);

    const inviteToken = crypto.randomBytes(32).toString("hex");
    const inviteTokenHash = crypto.createHash("sha256").update(inviteToken).digest("hex");

    /**
     * Validated here, not only in the form.
     *
     * The console checks all of this, but the endpoint accepted anything: a
     * region of "Atlantis", an email of "not-an-email", no address, a state of
     * "ZZ", a negative sheet size. None of it errors — it produces a partner
     * that is quietly broken:
     *
     *  - a region that does not normalize makes them unassignable, because
     *    `normalizeRegion` returns null and a null region blocks assignment
     *  - an unresolvable state means no region and an infinite distance, so
     *    they rank last in their own region forever
     *  - a malformed email means they can never be contacted or sign in
     *
     * A form is a convenience, not a boundary. This is the boundary.
     */
    // The shared validator, so this rule and public registration's cannot drift.
    if (!isValidEmail(String(email).trim())) {
      const error = new Error("A valid email address is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * Same shape check as public signup. This endpoint required phone to be
     * present but never checked what was in it, so "1" or "abc" created a
     * partner with an unreachable contact number.
     */
    if (typeof phone === "string" && phone.trim() && !isValidPhone(phone)) {
      const error = new Error("Enter a valid phone number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const suppliedRegions = Array.isArray(regions) ? regions : [];
    const normalizedRegions = suppliedRegions
      .map((r: any) => normalizeRegion(String(r).trim()))
      .filter(Boolean) as string[];
    if (normalizedRegions.length !== suppliedRegions.length) {
      const unknown = suppliedRegions.filter((r: any) => !normalizeRegion(String(r).trim()));
      const error = new Error(
        `Unrecognised service area(s): ${unknown.join(", ")}. Must be one of West, Midwest, South, Northeast.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * The address is optional now, but if one is given it must be usable: a
     * state that resolves to no region means no ranking distance and no
     * shipping origin, which is worse than having no address at all because it
     * looks complete.
     */
    const hasAddress = Boolean(address && typeof address === "object" && String(address.street || "").trim());
    if (hasAddress) {
      if (!getRegionFromState(String(address.state || ""))) {
        const error = new Error(
          `'${address.state}' is not a US state this platform serves`,
        ) as CustomError;
        error.statusCode = 400;
        throw error;
      }
      if (!String(address.city || "").trim() || !String(address.postalCode || "").trim()) {
        const error = new Error("Business address needs a city and a postal code") as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    /*
     * An admin adding a partner IS the approval — they already vouched for them
     * off-platform. Defaulting to Pending made the invitation a dead end: the
     * partner set their password from the invite email and then hit "Your
     * account is pending approval" at sign-in, with no way to fill in the
     * business details the admin deliberately left for them to complete.
     *
     * Partners who sign up on their own still land in Pending (see
     * `registerUser`) and still need approving — that is the Approvals queue.
     */
    const allowedStatuses = ["Active", "Pending", "Suspended", "Under Review"];
    const resolvedStatus = (typeof status === "string" && allowedStatuses.includes(status)) ? status : "Active";

    /**
     * A partner created without an address is quietly degraded, not broken —
     * which is worse, because nothing reports it:
     *
     *  - `predictShippingOrigin` needs a postcode, so rates for their region
     *    fall back to the configured warehouse instead of shipping from them.
     *  - `createShipStationLabel` uses `businessAddress` as the ship-from, so
     *    their labels declare the wrong origin.
     *  - candidate ranking sorts nearest-first on a state centroid; with no
     *    state the distance is Infinity, so they are always chosen last within
     *    their own region.
     *
     * Stored in both fields because both are read: `businessAddress` for the
     * label, `defaultShippingAddress` for region and distance.
     */
    const resolvedPartnerAddress =
      address && typeof address === "object"
        ? await resolveAddress({
            street: String(address.street || "").trim(),
            city: String(address.city || "").trim(),
            state: String(address.state || "").trim().toUpperCase(),
            postalCode: String(address.postalCode || "").trim(),
            country: String(address.country || "US").trim(),
          })
        : null;

    const partnerAddress = resolvedPartnerAddress
      ? {
          ...resolvedPartnerAddress.address,
          ...(resolvedPartnerAddress.coordinates
            ? { coordinates: resolvedPartnerAddress.coordinates }
            : {}),
        }
      : null;

    /*
     * The admin picks service areas explicitly, so those stay authoritative.
     * `detectedRegion` records what the address itself resolves to, which is a
     * different fact and the one both profile screens display.
     */
    const partnerDetectedRegion = resolvedPartnerAddress?.region ?? null;

    const newPartner = new User({
      name: resolvedContactName,
      companyName: resolvedCompanyName,
      email: String(email).trim(),
      phone: String(phone).trim(),
      regions: normalizedRegions,
      role: UserRoles.PRINTER,
      status: resolvedStatus,
      passwordHash,
      /*
       * Stored in the reset-password fields rather than a new pair, so the
       * existing `POST /auth/reset-password` consumes an invite unchanged. A
       * 7-day window because this is an invitation, not a password recovery —
       * the 15 minutes used for recovery would expire before most people read
       * their email.
       */
      resetPasswordTokenHash: inviteTokenHash,
      resetPasswordExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      /*
       * Opens the trail, recording that this partner exists because an admin
       * added them rather than because they applied — which is also why they
       * start Active rather than Pending.
       */
      statusHistory: [
        {
          from: null,
          to: resolvedStatus,
          reason: "Added by an admin",
          at: new Date(),
          byId: req.user?.id || null,
          byName: req.user?.name || req.user?.email || null,
          notified: false,
        },
      ],
      ...(partnerAddress
        ? { businessAddress: partnerAddress, defaultShippingAddress: partnerAddress }
        : {}),
      ...(partnerDetectedRegion ? { detectedRegion: partnerDetectedRegion } : {}),
      settings: {
        /*
         * No per-partner pricing is written. Every partner is paid at the one
         * network rate from Settings -> General, resolved at payout time by
         * `getPartnerPayRate`. A copy stored here would be a second source of
         * truth free to drift from it.
         */
      }
    });

    await newPartner.save();

    const inviteUrl = `${env.printerAppUrl.replace(/\/$/, "")}/set-password?inviteToken=${encodeURIComponent(inviteToken)}`;
    const invite = await sendEmail({
      to: String(email).trim(),
      subject: "You have been added to Space Transfers",
      html: `
        <p>Hello ${resolvedContactName || resolvedCompanyName},</p>
        <p>${resolvedCompanyName} has been added to Space Transfers as a print partner.</p>
        <p>Set your password to get started — the link is valid for 7 days:</p>
        <p><a href="${inviteUrl}">Set your password</a></p>
        <p>Once you are in, please check that your business address is correct — we
          route work by region, so it decides which orders reach you. We cannot send you
          work until your account has been approved.</p>
      `,
    }).catch((e: any) => ({ sent: false, messageId: null, error: e?.message || "send failed" }));

    if (!invite.sent) {
      // Loud, because the partner cannot sign in until this reaches them — and
      // silence here is exactly how the previous version hid the same problem.
      console.error(
        `[PARTNER_INVITE] could not email ${email} — they cannot set a password until this is fixed. ` +
          `Reason: ${invite.error || "no email transport configured"}`,
      );
    } else {
      console.log(`[PARTNER_INVITE] invite sent to ${email}`);
    }

    res.status(201).json({
      id: newPartner._id,
      status: newPartner.status,
      /*
       * Whether the invitation actually reached them, and the link itself when
       * it did not.
       *
       * A failed send was written to the server log and nowhere else: the
       * console showed "Partner created", the admin had no idea the email had
       * not gone out, and the link existed only inside an email that was never
       * sent — so the partner could never set a password and nothing on screen
       * said why. The URL is returned only on failure, so it is there exactly
       * when someone needs to pass it on by hand and not in the ordinary case.
       */
      invite: {
        sent: invite.sent === true,
        reason: invite.sent ? undefined : invite.error || "no email transport configured",
        url: invite.sent ? undefined : inviteUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listPartners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, region, search, cursor, limit = "20" } = req.query;
    const pageSize = parseInt(limit as string);

    const matchQuery: any = { role: UserRoles.PRINTER };

    if (status) {
      matchQuery.status = status;
    }

    if (region) {
      matchQuery.regions = String(region);
    }

    if (search) {
      // Escaped: the raw value was compiled straight into a RegExp, so a single
      // "[" typed into the search box threw and returned a 500.
      const searchRegex = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      matchQuery.$or = [
        { name: searchRegex },
        { companyName: searchRegex },
        { email: searchRegex }
      ];
    }

    const pipeline: any[] = [
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
        /*
         * How many jobs this partner is holding right now.
         *
         * Replaces the base/sale/profit columns, which became the same three
         * numbers on every row once pricing went network-wide. This one differs
         * per partner and is what an admin needs when deciding who to assign to.
         */
        $lookup: {
          from: "orders",
          let: { partnerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$assignedPrinter", "$$partnerId"] },
                    { $in: ["$status", ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"]] }
                  ]
                }
              }
            },
            { $count: "count" }
          ],
          as: "activeCountArr"
        }
      },
      {
        $addFields: {
          ordersCompleted: { $ifNull: [{ $arrayElemAt: ["$completedCountArr.count", 0] }, 0] },
          ordersInProgress: { $ifNull: [{ $arrayElemAt: ["$activeCountArr.count", 0] }, 0] }
        }
      },
      {
        $project: {
          companyName: 1,
          name: 1,
          email: 1,
          status: 1,
          availabilityStatus: 1,
          capacityPaused: 1,
          regions: 1,
          rating: 1,
          ordersCompleted: 1,
          ordersInProgress: 1,
        }
      },
      { $sort: { ordersCompleted: -1, _id: -1 } }
    ];

    if (cursor) {
      const [cursorValue, cursorId] = (cursor as string).split("_");
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

    pipeline.push({ $limit: pageSize + 1 });

    const partners = await User.aggregate(pipeline);

    const hasNextPage = partners.length > pageSize;
    const results = hasNextPage ? partners.slice(0, pageSize) : partners;

    const formattedPartners = results.map(p => ({
      id: p._id,
      name: p.companyName || p.name,
      email: p.email,
      status: p.status,
      availabilityStatus: p.availabilityStatus ?? "open",
      // Carried alongside it so the console can distinguish a partner who
      // paused themselves from one the capacity monitor paused — the first
      // needs a conversation, the second clears itself.
      capacityPaused: Boolean(p.capacityPaused),
      regions: p.regions || [],
      rating: p.rating || 5.0,
      ordersCompleted: p.ordersCompleted,
      /*
       * Base price, sale price and profit removed. With one network-wide rate
       * they were the same three numbers on every row, and "profit" was a
       * per-sq-ft margin rather than this partner's contribution — which read
       * like a partner-level figure and was not one.
       */
      ordersInProgress: Number(p.ordersInProgress ?? 0).toLocaleString(),
      orders: Number(p.ordersCompleted ?? 0).toLocaleString()
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

export const getPartnerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("-passwordHash")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const ordersCompleted = await Order.countDocuments({
      assignedPrinter: partnerIdString,
      status: "COMPLETED"
    });

    /*
     * Moved to `partnerPerformance.service`. The partner's own Profile page
     * showed invented figures for these same two ideas — a stored
     * `user.performance` object nothing ever writes — so both sides read one
     * computation now.
     */
    const { averageProductionHours, onTimeDeliveryRate, sampleSize: performanceSamples } =
      await computePartnerPerformance(partnerIdString);

    const detectedRegion =
      (partner as any).detectedRegion ||
      normalizeRegion(getRegionFromState((partner as any).businessAddress?.state || "")) ||
      normalizeRegion(getRegionFromState((partner.defaultShippingAddress as any)?.state || "")) ||
      (partner.regions?.[0] ?? null);

    res.status(200).json({
      id: partner._id,
      name: partner.companyName || partner.name,
      companyName: partner.companyName || partner.name,
      contactName: partner.name,
      status: partner.status,
      /*
       * Operational availability, distinct from account status above. The
       * console rendered neither this nor the live broadcast the server was
       * already sending, so a partner who paused themselves looked fully
       * available to the admin deciding where to route work.
       */
      availabilityStatus: (partner as any).availabilityStatus ?? "open",
      capacityPaused: Boolean((partner as any).capacityPaused),
      statusHistory: [...(((partner as any).statusHistory || []) as any[])]
        .reverse()
        .slice(0, 20)
        .map((h) => ({
          from: h.from || null,
          to: h.to,
          reason: h.reason || null,
          at: h.at,
          by: h.byName || null,
          notified: h.notified === true,
        })),
      regions: partner.regions || [],
      detectedRegion,
      /*
       * Where they print from. The detail page rendered a hardcoded "N/A" here
       * and the endpoint never sent an address at all, so a partner who gave a
       * full address at signup was shown as having none — on the same screen
       * that decides whether they can be routed work.
       *
       * `businessAddress` first: that is the ship-from on a label. It falls back
       * to the shipping address, which is what signup fills in.
       */
      address: (() => {
        const a = (partner as any).businessAddress || (partner as any).defaultShippingAddress || null;
        if (!a) return null;
        return {
          street: a.street || null,
          city: a.city || null,
          state: a.state || null,
          postalCode: a.postalCode || null,
          country: a.country || null,
        };
      })(),
      ordersCompleted,
      averageProductionHours,
      onTimeDeliveryRate,
      // Measured against how many finished jobs, so the console can say "from
      // 3 orders" rather than presenting one data point as a track record.
      performanceSampleSize: performanceSamples,
      rating: partner.rating || 5.0,
      email: partner.email,
      phone: partner.phone || "N/A",
      website: partner.website || "N/A",
      businessType: (partner as any).businessDetails?.businessType || null
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status, cursor, limit = "20" } = req.query;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const query: any = { assignedPrinter: partnerIdString };

    if (status) {
      query.status = resolveOrderStatusInput(status) ?? String(status).toUpperCase();
    }

    if (cursor) {
      const [cursorTime, cursorId] = (cursor as string).split("_");
      query.$or = [
        { createdAt: { $lt: new Date(Number(cursorTime)) } },
        { 
          createdAt: new Date(Number(cursorTime)), 
          _id: { $lt: cursorId } 
        }
      ];
    }

    const pageSize = parseInt(limit as string);
    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    const formattedOrders = results.map(order => ({
      id: order._id,
      displayId: (order as any).displayId || null,
      status: order.status,
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

export const updatePartner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { regions } = req.body ?? {};

    if (!Array.isArray(regions) || regions.length === 0) {
      const error = new Error("regions must be a non-empty array") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const normalizedRegions = regions
      .map((r: any) => normalizeRegion(String(r).trim()))
      .filter(Boolean) as string[];
    if (normalizedRegions.length !== regions.length) {
      const unknown = regions.filter((r: any) => !normalizeRegion(String(r).trim()));
      const error = new Error(
        `Unrecognised service area(s): ${unknown.join(", ")}. Must be one of West, Midwest, South, Northeast.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: { regions: normalizedRegions } },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
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

/**
 * An admin setting a partner's availability.
 *
 * Distinct from `updatePartnerStatus`: that is an account judgement that blocks
 * sign-in, this is operational — whether the partner is currently taking work.
 * An admin needs it to pull someone out of rotation without suspending them,
 * for instance while a quality issue is being discussed.
 *
 * Unlike the partner's own endpoint, an admin may reopen someone who is at
 * capacity: that is a deliberate act by a person who can see the whole network,
 * not a partner accidentally over-committing themselves.
 */
export const updatePartnerAvailability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status, reason } = req.body || {};

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : (partnerId as string);
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (status !== "open" && status !== "paused") {
      const error = new Error("status must be one of: open, paused") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const result = await changePartnerAvailability({
      partnerId: partnerIdString,
      to: status,
      reason: typeof reason === "string" ? reason : null,
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email, kind: "admin" },
    });

    if (!result) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      partnerId: partnerIdString,
      availabilityStatus: result.availabilityStatus,
      capacityLocked: result.capacityLocked,
      // Always false after a manual change — the console reads it to decide
      // whether to label the pill "at capacity", and an absent field there
      // would quietly become `false` by accident rather than by fact.
      capacityPaused: result.capacityPaused,
      activeJobs: result.activeJobs,
      maxJobs: result.maxJobs,
      // Whether the partner's in-app notification was created, so the console
      // can say plainly if they were not told.
      notified: result.partnerNotified,
      notifyError: result.partnerNotifyError,
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status, reason } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    /*
     * "Rejected" is deliberately not settable here. It is the outcome of
     * declining a pending application, not a state to move a real partner into
     * — that is what Suspended is for. Offering both on one dropdown would make
     * the difference a matter of which word an admin happened to pick.
     */
    if (!["Active", "Suspended", "Under Review", "Pending"].includes(status)) {
      const error = new Error("Invalid status. Allowed values: Active, Suspended, Under Review, Pending") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * And rejection is terminal. A suspension is a pause the network can lift;
     * a rejection is a declined application, and reinstating one through a
     * status dropdown would quietly undo an approval decision without ever
     * passing back through the approvals queue.
     */
    const existingPartner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("status")
      .lean();
    if (existingPartner?.status === "Rejected") {
      const error = new Error(
        "This application was rejected and cannot be reinstated here. They can re-apply from the partner sign-up page, which starts a fresh application."
      ) as CustomError;
      error.statusCode = 409;
      throw error;
    }

    if (status === "Suspended" && (typeof reason !== "string" || reason.trim().length < 3)) {
      const error = new Error("A reason is required when suspending a partner") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const result = await changePartnerStatus({
      partnerId: partnerIdString,
      to: status,
      reason: typeof reason === "string" ? reason : null,
      // Anything but Rejected, which the check above already refuses.
      expectedFrom: ["Active", "Suspended", "Under Review", "Pending"],
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email },
    });

    if (!result) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: result.partner._id,
      status: result.partner.status,
      notified: result.notified,
      notifyError: result.notifyError,
      updated: true
    });
  } catch (error) {
    next(error);
  }
};

export const listPendingPrinters = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printers = await User.find({ role: UserRoles.PRINTER, status: "Pending" })
      .select("name companyName email phone createdAt regions defaultShippingAddress businessAddress statusHistory")
      .sort({ createdAt: -1 })
      .lean();

    /*
     * Who else is already registered at each of these addresses.
     *
     * Sharing one is not itself wrong — industrial units and co-working
     * buildings hold several businesses — so this does not block a signup. But
     * it is the shape both duplicate registration and rejection-evasion take,
     * and the approval screen is the one moment a person is deciding about this
     * applicant. Three accounts for the same company already sit at one address
     * in this database, all approved, because nothing ever surfaced it.
     *
     * Fetched in one query keyed by street and postcode rather than per row.
     */
    const addressKey = (a: any) =>
      a && a.street && a.postalCode
        ? `${String(a.street).trim().toLowerCase()}|${String(a.postalCode).trim().toLowerCase()}`
        : null;

    const pendingKeys = printers
      .map((p: any) => addressKey(p.defaultShippingAddress || p.businessAddress))
      .filter(Boolean) as string[];

    const neighboursByKey = new Map<string, Array<{ companyName: string; status: string }>>();
    if (pendingKeys.length > 0) {
      const others = await User.find({
        role: UserRoles.PRINTER,
        _id: { $nin: printers.map((p: any) => p._id) },
      })
        .select("companyName name status defaultShippingAddress businessAddress")
        .lean();

      for (const other of others as any[]) {
        const key = addressKey(other.defaultShippingAddress || other.businessAddress);
        if (!key || !pendingKeys.includes(key)) continue;
        const list = neighboursByKey.get(key) || [];
        list.push({
          companyName: other.companyName || other.name || "Unnamed partner",
          status: other.status || "Unknown",
        });
        neighboursByKey.set(key, list);
      }
    }

    const formattedPrinters = printers.map(p => {
      const address = (p as any).defaultShippingAddress || (p as any).businessAddress || null;
      const key = addressKey(address);
      return {
        id: p._id,
        name: p.name,
        companyName: p.companyName,
        email: p.email,
        phone: p.phone,
        createdAt: p.createdAt,
        // Null rather than a guess: geocoding can fail, and registration stores
        // no region when it does. "Unknown" on screen is honest; a wrong region
        // would route real work to the wrong side of the country.
        region: resolvePartnerRegion(p),
        location: address ? [address.city, address.state].filter(Boolean).join(", ") || null : null,
        /** Other partners at the same street and postcode. Empty when none. */
        sameAddressPartners: (key && neighboursByKey.get(key)) || [],
        /*
         * A previous rejection of this same account, now that a declined
         * applicant can re-apply with the address they used before. Without it
         * a re-application is indistinguishable from a first one, and the
         * approver repeats a decision someone already made.
         */
        priorRejection: (() => {
          const history = ((p as any).statusHistory || []) as any[];
          const last = [...history].reverse().find((h) => h.to === "Rejected");
          if (!last) return null;
          return {
            at: last.at,
            reason: last.reason || null,
            by: last.byName || null,
          };
        })()
      };
    });

    res.status(200).json(formattedPrinters);
  } catch (error) {
    next(error);
  }
};

export const approvePrinter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { reason } = req.body || {};

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const result = await changePartnerStatus({
      partnerId: partnerIdString,
      to: "Active",
      reason: typeof reason === "string" ? reason : null,
      expectedFrom: "Pending",
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email },
    });

    if (!result) {
      const existing = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
        .select("status")
        .lean();
      const error = new Error(
        existing
          ? `This printer is already ${existing.status}, not awaiting approval. Refresh the queue.`
          : "Printer not found"
      ) as CustomError;
      error.statusCode = existing ? 409 : 404;
      throw error;
    }

    res.status(200).json({
      id: result.partner._id,
      status: result.partner.status,
      notified: result.notified,
      notifyError: result.notifyError,
      message: "Printer approved successfully"
    });
  } catch (error) {
    next(error);
  }
};

export const rejectPrinter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { reason } = req.body || {};

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (typeof reason !== "string" || reason.trim().length < 3) {
      const error = new Error("A reason is required when rejecting an application") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const result = await changePartnerStatus({
      partnerId: partnerIdString,
      to: "Rejected",
      reason,
      expectedFrom: "Pending",
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email },
    });

    if (!result) {
      const existing = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
        .select("status")
        .lean();
      const error = new Error(
        existing
          ? `This printer is already ${existing.status}, not awaiting approval. Refresh the queue.`
          : "Printer not found"
      ) as CustomError;
      error.statusCode = existing ? 409 : 404;
      throw error;
    }

    res.status(200).json({
      id: result.partner._id,
      status: result.partner.status,
      notified: result.notified,
      notifyError: result.notifyError,
      message: "Printer registration rejected"
    });
  } catch (error) {
    next(error);
  }
};

export const adjustOrderFinancials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { adjustments } = req.body;

    if (!Array.isArray(adjustments) || adjustments.length === 0) {
      const error = new Error("Adjustments array is required and cannot be empty") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!order.pricing.adjustments) {
      order.pricing.adjustments = [];
    }

    let totalAdjustment = 0;
    adjustments.forEach(adj => {
      const { type, amount, reason } = adj;
      
      if (!["discount", "surcharge", "credit", "fee"].includes(type)) {
        const error = new Error(`Invalid adjustment type: ${type}`) as CustomError;
        error.statusCode = 400;
        throw error;
      }

      if (typeof amount !== "number" || amount <= 0) {
        const error = new Error("Adjustment amount must be a positive number") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      order.pricing.adjustments!.push({ type, amount, reason, createdAt: new Date() });

      if (type === "discount" || type === "credit") {
        totalAdjustment -= amount;
      } else {
        totalAdjustment += amount;
      }

      if (!order.statusTimeline) order.statusTimeline = [];
      order.statusTimeline.push({
        status: order.status,
        time: new Date(),
        message: `Financial adjustment: ${type.toUpperCase()} of ${amount} applied. Reason: ${reason}`,
        actorRole: "ADMIN",
        actorId: String(req.user?.id || ""),
        actorName: null
      });
    });

    order.pricing.total = Math.max(0, order.pricing.total + totalAdjustment);
    
    await order.save();

    // Same profit definition as every other admin screen.
    const margin = computeOrderFinancials(order.toObject ? order.toObject() : order, await getPartnerPayRate()).profit;

    res.status(200).json({
      customerCharge: Number(order.pricing.total.toFixed(2)),
      margin,
      currency: order.pricing.currency
    });
  } catch (error) {
    next(error);
  }
};

export const downloadOrderInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString);

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const formattedItems = (order.items || []).map((item) => {
      const description =
        formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "";
      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: (item.unitPrice || 0).toFixed(2),
        subtotal: (item.subtotal || 0).toFixed(2)
      };
    });

    const pricing = order.pricing || {};
    // Shared with the customer's invoice, so both copies list the same charges.
    const lineItems = orderChargeLines(order);

    const data = {
      // The invoice is the most customer-visible document there is, so it
      // carries the canonical DTF-#### number rather than the raw ObjectId.
      orderId: (order as any).displayId || String(order._id),
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

    const pdfBuffer = await renderInvoicePdf(data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${data.orderId}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);

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

      return { revenue, cost, tax, shipping, cardFees, feesMissing, margin, earned, earnedOrders, uncostable };
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

export const getPartnerAssignmentSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await Settings.findOne({ key: "partnerAssignment" }).lean();
    const value = (settings as any)?.value || {};

    res.json({
      assignmentRule: value.rule || "nearest-region",
      maxJobsEnabled: value.maxJobsEnabled !== false,
      // The stored number, whether the limit is on or off, so the console can
      // show what it would go back to. 10 only stands in for "never set".
      maxJobsValue: Number(value.maxJobsValue) > 0 ? Math.floor(Number(value.maxJobsValue)) : 10,
      // Normalised, so a document saved before the SLA existed still comes back
      // with usable windows instead of blanks the console would save over.
      sla: normalizeSlaSettings(value.sla),
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerAssignmentSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { assignmentRule, maxJobsEnabled, maxJobsValue, sla } = req.body;

    if (!assignmentRule || !["nearest-region", "manual"].includes(assignmentRule)) {
      return res.status(400).json({ error: "Invalid assignment rule" });
    }

    /**
     * Merged over what is stored, not written fresh.
     *
     * This replaced the whole value object from three named fields, so saving
     * the assignment rule would have silently deleted the SLA windows — and the
     * monitor would have carried on against defaults nobody chose. Same failure
     * the pricing settings had.
     */
    const existing = await Settings.findOne({ key: "partnerAssignment" }).lean();
    const enabled = maxJobsEnabled !== false;
    const previousMax = Number((existing as any)?.value?.maxJobsValue);
    const keptMax = Number.isFinite(previousMax) && previousMax > 0 ? Math.floor(previousMax) : null;
    const parsedMax = parseInt(maxJobsValue, 10);

    // A limit that is on must be a real number — storing NaN would disable
    // capacity checks silently, which is the opposite of what was asked for.
    if (enabled && (!Number.isFinite(parsedMax) || parsedMax < 1)) {
      const error = new Error("Maximum jobs per partner must be a whole number of at least 1.") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const settingValue = {
      rule: assignmentRule,
      maxJobsEnabled: enabled,
      maxJobsValue: enabled ? parsedMax : keptMax,
      sla: normalizeSlaSettings(sla ?? (existing as any)?.value?.sla),
    };

    let settings = await Settings.findOne({ key: "partnerAssignment" });
    if (!settings) {
      settings = new Settings({
        key: "partnerAssignment",
        value: settingValue,
      });
    } else {
      settings.value = settingValue;
    }

    await settings.save();

    res.json({
      assignmentRule: settingValue.rule,
      maxJobsEnabled: settingValue.maxJobsEnabled,
      maxJobsValue: settingValue.maxJobsValue,
      sla: settingValue.sla,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminNotificationSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN })
      .select("settings.notifications")
      .lean();

    const emailPrefs = (admin as any)?.settings?.notifications?.email || {};

    res.status(200).json({
      email: {
        orderUpdates: typeof emailPrefs.orderUpdates === "boolean" ? emailPrefs.orderUpdates : true,
        partnerActivity: typeof emailPrefs.partnerActivity === "boolean" ? emailPrefs.partnerActivity : true,
        systemAlerts: typeof emailPrefs.systemAlerts === "boolean" ? emailPrefs.systemAlerts : true
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminNotificationSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    const email = req.body?.email;
    if (!email || typeof email !== "object") {
      const error = new Error("email is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const nextPrefs = {
      orderUpdates: typeof email.orderUpdates === "boolean" ? email.orderUpdates : true,
      partnerActivity: typeof email.partnerActivity === "boolean" ? email.partnerActivity : true,
      systemAlerts: typeof email.systemAlerts === "boolean" ? email.systemAlerts : true
    };

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN });
    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const settings: any = (admin as any).settings || {};
    const notifications: any = settings.notifications || {};
    const notifEmail: any = notifications.email || {};
    notifications.email = { ...notifEmail, ...nextPrefs };
    settings.notifications = notifications;
    (admin as any).settings = settings;
    admin.markModified("settings.notifications");
    await admin.save();

    res.status(200).json({ email: nextPrefs });
  } catch (error) {
    next(error);
  }
};
