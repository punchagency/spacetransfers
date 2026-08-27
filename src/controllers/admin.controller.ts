import { Request, Response, NextFunction } from "express";
import { resolveOrderPriorityInput, resolveOrderStatusInput } from "../utils/orderStatusInput.js";
import { getRegionFromState, normalizeRegion } from "../utils/region.js";
import { sendEmail } from "../services/email.service.js";
import mongoose from "mongoose";
import fs from "fs";
import sharp from "sharp";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { renderInvoicePdf } from "../services/invoicePdf.service.js";
import { Order, IOrder } from "../models/order.model.js";
import { User, UserRoles, IUser } from "../models/user.model.js";
import { Settings } from "../models/settings.model.js";
import { uploadBufferToCloudinary } from "../utils/cloudinary.js";
import { LoginActivity } from "../models/loginActivity.model.js";
import { Design } from "../models/design.model.js";
import { AdminNotification } from "../models/adminNotification.model.js";
import { addAdminNotificationClient, publishAdminNotificationEvent, removeAdminNotificationClient } from "../services/adminNotificationsHub.js";
import { notifyAllAdmins, createAdminNotification } from "../services/adminNotifications.service.js";
import { notifyPrinter } from "../services/printerNotifications.service.js";
import {
  calculateOrderPartnerEarning,
  canDerivePartnerEarning,
  getOrderPartnerCostBreakdown,
  isPartnerEarningRealized,
} from "../services/partnerEarnings.service.js";
import {
  DEFAULT_GLOBAL_PRICING,
  getPartnerPayRate,
  normalizeGlobalPricing,
  getGlobalPricing as getGlobalPricingRates,
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
  GANGSHEET_SHEET_WIDTH_IN,
} from "../services/gangsheetExport.service.js";
import { env } from "../config/env.js";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";
import { computeAssignmentDeadlineFor, resolveOrderDeadlineIso } from "../utils/assignmentDeadline.js";

interface CustomError extends Error {
  statusCode?: number;
}

const resolveOrderRegion = (
  order: any,
  userRegionMap?: Map<string, string | null>
): string | null => {
  const userId = order?.user ? String(order.user) : null;
  const regionFromUser = userId && userRegionMap ? userRegionMap.get(userId) : null;
  return (
    normalizeRegion(order?.customer?.region) ||
    normalizeRegion(regionFromUser || undefined) ||
    normalizeRegion(getRegionFromState(order?.shippingAddress?.state)) ||
    null
  );
};

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
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions settings.pricing");

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

    /**
     * Margin on an order: what the customer paid, minus what the assigned
     * partner is owed.
     *
     * The payout comes from `calculateOrderPartnerEarning` — the same function
     * that drives real payouts — so this figure matches what actually leaves
     * the business. It previously assumed a flat $3.50/sq ft for every partner
     * (and $5.00 for dimensionless items), ignoring each partner's negotiated
     * base rate, tiers, rush percentage and special-ink fee. For a partner on
     * $2.50/sq ft that understated margin by a dollar per square foot, and it
     * overstated for anyone above $3.50.
     *
     * With no partner assigned there is no negotiated rate yet, so the shared
     * default applies and the result is an expected margin rather than a
     * settled one.
     */
    // One rate for the whole network, read once for this response rather than
    // per order.
    const partnerPayRate = await getPartnerPayRate();

    const calculateOrderFinancials = (order: any) => {
      const customerCharge = order.pricing?.total || 0;
      const partnerPricing = partnerPayRate;

      // Null, not zero, when there is nothing to derive a cost from — see
      // `canDerivePartnerEarning`. Subtracting a zero we invented is how an
      // order with no sheet dimensions came to report 100% margin.
      if (!canDerivePartnerEarning(order)) {
        return { customerCharge, partnerPayout: null, profit: null };
      }

      const partnerPayout = calculateOrderPartnerEarning(order, partnerPricing);
      return { customerCharge, partnerPayout, profit: customerCharge - partnerPayout };
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

    // One source for the fallback, so this endpoint and the pricer cannot
    // drift — they previously agreed only by coincidence.
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
    /**
     * The whole document is rewritten on save, so every field has to be listed
     * here. It previously named only three, which meant saving from the console
     * silently deleted the shipping markup and packaging profile — the rates
     * would keep working, quietly, on defaults nobody chose.
     *
     * Normalising the merged result also means a partial request cannot blank a
     * field: anything absent falls back to what is already stored.
     */
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
      },
      sms: {}
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

    res.status(200).json({ email: nextPrefs, sms: {} });
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
      /*
       * Bio, gender, date of birth, national ID, tax ID and a postal address
       * are no longer collected or returned. Nothing read any of them — they
       * were stored, echoed back, and used by nothing.
       *
       * Date of birth and national ID are the ones worth naming: holding
       * identity documents for staff with no purpose is a liability, not a
       * feature. An admin account needs a name, an email, a phone number and a
       * picture.
       */
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
      const existing = await User.findOne({ email: nextEmail, _id: { $ne: admin._id } }).select("_id");
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
      // Cloudinary. Accepting a data: URL here would put the whole image back
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

/**
 * Avatar upload.
 *
 * Mirrors the printer app's `uploadProfileAsset`: the image is resized, encoded
 * as WebP and stored on Cloudinary, and only the URL is kept on the user.
 *
 * The admin console previously read the file as a base64 `data:` URL and PATCHed
 * that onto `avatarUrl`, so the whole image lived on the user document. That is
 * expensive in a way that is easy to miss: `authenticate` loads the full user on
 * every authenticated request, so a 400 KB avatar became ~546 KB of base64 read
 * from Mongo on *every* API call that admin made.
 */
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

    const { url } = await uploadBufferToCloudinary(optimized, "space-transfers/avatars");
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

export const getRevenueChart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { range = "30d" } = req.query;

    let startDate: Date;                                                                                                                                     
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    if (range === "7d") {
      startDate = new Date(new Date().setDate(now.getDate() - 6));
    } else if (range === "90d") {
      startDate = new Date(new Date().setDate(now.getDate() - 89));
    } else if (range === "ytd") {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate = new Date(new Date().setDate(now.getDate() - 29));
    }
    startDate.setHours(0, 0, 0, 0);

    const orders = await Order.find({
      createdAt: { $gte: startDate }, 
      status: { $nin: ["CANCELLED", "REJECTED"] }
    }).select("pricing.total createdAt"); 

    const dailyRevenue: { [key: string]: number } = {};
    orders.forEach(order => {
      const dateKey = order.createdAt.toISOString().split("T")[0];
      dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + (order.pricing?.total || 0);
    });

    const points: { date: string, revenue: number }[] = [];
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

    // Keyset cursor — format: "${updatedAt.getTime()}_${_id}"
    // updatedAt is bumped on every write (save, updateOne with explicit $set), so it's the
    // single reliable sort key for "most recently touched first".
    if (cursor && typeof cursor === "string" && cursor.includes("_")) {
      const underscoreIdx = cursor.lastIndexOf("_");
      const cursorTsStr = cursor.slice(0, underscoreIdx);
      const cursorId = cursor.slice(underscoreIdx + 1);
      const cursorTs = Number(cursorTsStr);
      if (Number.isFinite(cursorTs) && mongoose.Types.ObjectId.isValid(cursorId)) {
        const cursorDate = new Date(cursorTs);
        const cursorObjId = new mongoose.Types.ObjectId(cursorId);
        extraFilters.push({
          $or: [
            { updatedAt: { $lt: cursorDate } },
            { updatedAt: cursorDate, _id: { $lt: cursorObjId } },
          ],
        });
      }
    }

    const finalQuery = extraFilters.length === 0 ? query : { ...query, $and: extraFilters };

    const pageSize = parseInt(limit as string);
    const orders = await Order.find(finalQuery)
      .select("-items.artboardItems")
      .sort({ updatedAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions settings.pricing")
      .lean();

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

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
      const firstItem = order.items?.[0] || {};
      const sheetSize = firstItem.widthIn && firstItem.heightIn 
        ? `${firstItem.widthIn}" x ${firstItem.heightIn}"`
        : "N/A";

      // Same source as the dashboard and as real payouts — see
      // calculateOrderFinancials above for why the flat rate was wrong.
      const customerCharge = order.pricing?.total || 0;
      const derivable = canDerivePartnerEarning(order);
      const profits = derivable
        ? customerCharge -
          calculateOrderPartnerEarning(order, partnerPayRate)
        : null;
  
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
        // The canonical human-readable id (DTF-0244) — the one on invoices,
        // notifications and ShipStation. The table used to derive its own
        // "#ORD-9CA3" from the ObjectId, which meant the number an admin could
        // see was not the number search would match.
        displayId: (order as any).displayId || null,
        region: resolveOrderRegion(order, userRegionMap),
        // Surfaced so the orders table can badge a fallback assignment rather
        // than the fact being buried in a timeline message.
        crossRegion: (order as any).crossRegionAssignment
          ? {
              customerRegion: (order as any).crossRegionAssignment.customerRegion,
              assignedRegion: (order as any).crossRegionAssignment.assignedRegion,
            }
          : null
      };
    });

    let nextCursor = null;
    if (hasNextPage) {
      const lastOrder = results[results.length - 1];
      const lastUpdatedAt = (lastOrder as any).updatedAt ?? lastOrder.createdAt;
      nextCursor = `${new Date(lastUpdatedAt).getTime()}_${lastOrder._id}`;
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
      .select("settings")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const settings = partner.settings || {};

    const notifications = {
      orderAssigned: settings.notifications?.email?.newJobs || false,
      jobCompleted: settings.notifications?.email?.orderUpdates || false
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

export const updatePartnerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { jobCapacity, notifications, capabilities } = req.body;

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
    }

    if (notifications) {
      if (notifications.orderAssigned !== undefined) updateData["settings.notifications.email.newJobs"] = notifications.orderAssigned;
      if (notifications.jobCompleted !== undefined) updateData["settings.notifications.email.jobUpdates"] = notifications.jobCompleted;
    }

    if (capabilities) {
      if (capabilities.maxDPI !== undefined) updateData["settings.printingCapabilities.maxResolutionDPI"] = capabilities.maxDPI;
      if (capabilities.maxSheetSizeIn !== undefined) updateData["settings.printingCapabilities.maxSheetSizeIn"] = capabilities.maxSheetSizeIn;
      if (capabilities.formats !== undefined) updateData["settings.printingCapabilities.supportedFormats"] = capabilities.formats;
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
      message: `Admin updated status to ${status}`,
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
    /*
     * Priority is deliberately not touched here.
     *
     * It is fixed at checkout by the customer's shipping choice and holds for
     * the order's whole life. Assignment used to overwrite it — defaulting to
     * "Normal" and writing unconditionally — which stripped rushes customers
     * had paid for.
     */
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
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName email regions")
      .lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const formattedItems = (order.items || []).map(item => ({
      name: item.name,
      size: item.widthIn && item.heightIn ? `${item.widthIn}" x ${item.heightIn}"` : "Custom",
      quantity: item.quantity,
      price: item.unitPrice,
      subtotal: item.subtotal
    }));

    const assignedPrinterId = (order as any).assignedPrinter?._id
      ? String((order as any).assignedPrinter._id)
      : (order as any).assignedPrinter
        ? String((order as any).assignedPrinter)
        : null;
    const partner = assignedPrinterId ? await User.findById(assignedPrinterId).select("settings.pricing").lean() : null;
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
    const totalPartnerCost = costDerivable ? breakdown.subtotal : null;

    const customerPaid = order.pricing?.total || 0;
    const adminProfit = totalPartnerCost === null ? null : customerPaid - totalPartnerCost;

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
      designThumbnail = typeof gangsheetOrderItem?.previewImage === "string" ? gangsheetOrderItem.previewImage : null;
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
        message: (entry as any).message || null,
        actorRole: (entry as any).actorRole || null,
        actorId: (entry as any).actorId || null,
        actorName: (entry as any).actorName ?? null
      })),

      financials: {
        customerPaid: Number(customerPaid.toFixed(2)),
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
        partnerCost: totalPartnerCost === null ? null : Number(totalPartnerCost.toFixed(2)),
        adminProfit: adminProfit === null ? null : Number(adminProfit.toFixed(2)),
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

      regionInfo: (() => {
        const orderCustomerRegion = resolveOrderRegion(order, oneUserRegionMap);
        const printerDoc = order.assignedPrinter as unknown as IUser | null;
        const orderPrinterRegion = printerDoc
          ? normalizeRegion(getRegionFromState((printerDoc.defaultShippingAddress as any)?.state || ""))
            || normalizeRegion(getRegionFromState((printerDoc as any).businessAddress?.state || ""))
            || printerDoc.regions?.[0]
            || null
          : null;
        return {
          customerRegion: orderCustomerRegion,
          printerRegion: orderPrinterRegion,
          crossRegion: Boolean(orderCustomerRegion && orderPrinterRegion && orderCustomerRegion !== orderPrinterRegion),
        };
      })(),

      preview: {
        designId,
        sheetSize: formattedItems[0]?.size || "N/A",
        fileUrl: designThumbnail,
        sheetWidthIn: designSize?.widthIn || null,
        sheetHeightIn: designSize?.heightIn || null,
        artboardItems: designArtboardItems
      }
    };

    (orderSummary as any).gangsheetItems = gangsheetItems;

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
                    copies: "$$ai.copies",
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

    const gangsheetItem = (orderRaw.items || []).find((i: any) => i?.type === "gangsheet") || (orderRaw.items || [])[0] || {};
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this order") as CustomError;
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

    const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
    const host = req.get("host") || "";
    const derivedBase = host ? `${proto}://${host}` : null;
    const appBase = env.appUrl && !env.appUrl.includes("localhost") ? env.appUrl : derivedBase;
    const previewDataUrl = appBase ? `${appBase}${rendered.relativePath}` : rendered.relativePath;

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
      // Same shared map as the list and the writer — this was a third and
      // fourth copy, both still mapping "Assigned" to PENDING.
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
      capabilities,
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
     * Everything else — phone, address, service areas, capabilities — is the
     * partner's own information, and they know it better than whoever is typing
     * the form. They fill it in after they set their password. Nothing can be
     * assigned to them before an admin approves them anyway, which is where
     * completeness is checked.
     */

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error("Partner with this email already exists") as CustomError;
      error.statusCode = 409;
      throw error;
    }

    /**
     * No temporary password is issued.
     *
     * This used to mint one, hash it, and then `console.log` it in plaintext —
     * a live credential written to the server logs — while sending nothing at
     * all, so the partner could never actually use it. The account now gets an
     * unusable random secret and the partner sets their own via an invite link,
     * which means there is no shared credential to leak in the first place.
     */
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim())) {
      const error = new Error("A valid email address is required") as CustomError;
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

    if (capabilities) {
      const { width, height } = capabilities.maxSheetSizeIn || {};
      const positive = (n: any) => Number.isFinite(Number(n)) && Number(n) > 0;
      if (capabilities.maxSheetSizeIn && !(positive(width) && positive(height))) {
        const error = new Error("Maximum sheet size must be positive") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      if (capabilities.maxDPI !== undefined && !positive(capabilities.maxDPI)) {
        const error = new Error("Maximum DPI must be a positive number") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      if (capabilities.formats !== undefined && (!Array.isArray(capabilities.formats) || capabilities.formats.length === 0)) {
        const error = new Error("At least one supported file format is required") as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    const allowedStatuses = ["Active", "Pending", "Suspended", "Under Review"];
    const resolvedStatus = (typeof status === "string" && allowedStatuses.includes(status)) ? status : "Pending";

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
    const partnerAddress = address && typeof address === "object"
      ? {
          street: String(address.street || "").trim(),
          city: String(address.city || "").trim(),
          state: String(address.state || "").trim().toUpperCase(),
          postalCode: String(address.postalCode || "").trim(),
          country: String(address.country || "US").trim(),
        }
      : null;

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
      ...(partnerAddress
        ? { businessAddress: partnerAddress, defaultShippingAddress: partnerAddress }
        : {}),
      settings: {
        /*
         * No per-partner pricing is written. Every partner is paid at the one
         * network rate from Settings -> General, resolved at payout time by
         * `getPartnerPayRate`. A copy stored here would be a second source of
         * truth free to drift from it.
         */
        printingCapabilities: {
          maxSheetSizeIn: capabilities?.maxSheetSizeIn || { width: 24, height: 19.5 },
          supportedFormats: capabilities?.formats || ["PNG", "PDF", "TIFF"],
          maxResolutionDPI: capabilities?.maxDPI || 1200
        }
      }
    });

    await newPartner.save();

    /**
     * A real send, through the shared `sendEmail` — which already tries
     * SendGrid first and falls back to SMTP, so this needs credentials, not
     * code. Until they exist it fails and says so; it no longer pretends.
     */
    const inviteUrl = `${env.printerAppUrl.replace(/\/$/, "")}/auth?inviteToken=${encodeURIComponent(inviteToken)}`;
    const invite = await sendEmail({
      to: String(email).trim(),
      subject: "You have been added to Space Transfers",
      html: `
        <p>Hello ${resolvedContactName || resolvedCompanyName},</p>
        <p>${resolvedCompanyName} has been added to Space Transfers as a print partner.</p>
        <p>Set your password to get started — the link is valid for 7 days:</p>
        <p><a href="${inviteUrl}">Set your password</a></p>
        <p>Once you are in, please complete your business address, service areas and
        printing capabilities. We cannot send you work until those are filled in and
        your account has been approved.</p>
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
      status: newPartner.status
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

    /**
     * Average production time and on-time rate, derived rather than displayed
     * as "N/A".
     *
     * Both were hard-coded placeholders in the component. The data to compute
     * them has been there all along: `assignedAt` is when the partner got the
     * job, the timeline records when it reached SHIPPED, and
     * `assignmentDeadline` is what they were given. Nothing needed collecting —
     * only reading.
     *
     * Measured to SHIPPED rather than COMPLETED because COMPLETED is set by
     * delivery confirmation from the carrier, which is not the partner's doing.
     */
    const shippedOrders = await Order.find({
      assignedPrinter: partnerIdString,
      status: { $in: ["SHIPPED", "COMPLETED"] },
      assignedAt: { $ne: null },
    })
      .select("assignedAt assignmentDeadline statusTimeline")
      .lean();

    const shippedAtOf = (o: any): Date | null => {
      const entries = Array.isArray(o.statusTimeline) ? o.statusTimeline : [];
      for (let i = entries.length - 1; i >= 0; i--) {
        if (String(entries[i]?.status || "").toUpperCase() === "SHIPPED") {
          const t = new Date(entries[i].time);
          return Number.isNaN(t.getTime()) ? null : t;
        }
      }
      return null;
    };

    const durationsMs: number[] = [];
    let onTime = 0;
    let deadlineKnown = 0;
    for (const o of shippedOrders) {
      const shippedAt = shippedAtOf(o);
      if (!shippedAt) continue;
      const assignedAt = new Date((o as any).assignedAt);
      if (Number.isNaN(assignedAt.getTime())) continue;

      const ms = shippedAt.getTime() - assignedAt.getTime();
      // A negative span means the timeline and the assignment stamp disagree —
      // usually a reassignment. Counting it would drag the average below zero.
      if (ms >= 0) durationsMs.push(ms);

      const deadline = (o as any).assignmentDeadline ? new Date((o as any).assignmentDeadline) : null;
      if (deadline && !Number.isNaN(deadline.getTime())) {
        deadlineKnown += 1;
        if (shippedAt <= deadline) onTime += 1;
      }
    }

    // Null, not zero: no finished jobs is "nothing to measure yet", and a 0%
    // on-time rate would read as a partner who never delivers on time.
    const averageProductionHours = durationsMs.length
      ? Number((durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / 3600000).toFixed(1))
      : null;
    const onTimeDeliveryRate = deadlineKnown
      ? Number(((onTime / deadlineKnown) * 100).toFixed(1))
      : null;

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
      regions: partner.regions || [],
      detectedRegion,
      ordersCompleted,
      averageProductionHours,
      onTimeDeliveryRate,
      // Measured against how many finished jobs, so the console can say "from
      // 3 orders" rather than presenting one data point as a track record.
      performanceSampleSize: durationsMs.length,
      rating: partner.rating || 5.0,
      email: partner.email,
      phone: partner.phone || "N/A",
      website: partner.website || "N/A"
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
      // Same shared map as the list and the writer — this was a third and
      // fourth copy, both still mapping "Assigned" to PENDING.
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

    /**
     * An allowlist, not a denylist.
     *
     * This took `req.body` wholesale, deleted `passwordHash` and `role`, and
     * `$set` the rest — so anything else in the body was written straight to
     * the partner document. A single PATCH could set their `rating`, or their
     * `settings.pricing.baseRatePerSqFt`, rewriting a commercial term without
     * going near the Pricing tab. Verified: a request setting the pay rate to
     * $99/sq ft was accepted.
     *
     * Service areas are the only thing this endpoint is for. They are the one
     * genuinely platform-owned field on a partner — routing policy, not the
     * partner's own information — and everything else has its own endpoint:
     * status, capacity settings, and pricing.
     */
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

export const updatePartnerStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!["Active", "Suspended", "Under Review", "Pending"].includes(status)) {
      const error = new Error("Invalid status. Allowed values: Active, Suspended, Under Review, Pending") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: { status } },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: partner._id,
      status: partner.status,
      updated: true
    });
  } catch (error) {
    next(error);
  }
};

export const listPendingPrinters = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printers = await User.find({ role: UserRoles.PRINTER, status: "Pending" })
      .select("name companyName email phone createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const formattedPrinters = printers.map(p => ({
      id: p._id,
      name: p.name,
      companyName: p.companyName,
      email: p.email,
      phone: p.phone,
      createdAt: p.createdAt
    }));

    res.status(200).json(formattedPrinters);
  } catch (error) {
    next(error);
  }
};

export const approvePrinter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: { status: "Active" } },
      { new: true }
    );

    if (!partner) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    console.log(`[EMAIL MOCK] Activation email sent to ${partner.email}`);

    notifyAllAdmins({
      category: "partners",
      priority: "medium",
      title: "Printer approved",
      message: `${partner.companyName || partner.name} • ${partner.email}`,
      meta: { partnerId: String(partner._id), status: "Active" }
    }).catch(() => {});

    res.status(200).json({
      id: partner._id,
      status: partner.status,
      message: "Printer approved successfully"
    });
  } catch (error) {
    next(error);
  }
};

export const rejectPrinter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: { status: "Suspended" } },
      { new: true }
    );

    if (!partner) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    notifyAllAdmins({
      category: "partners",
      priority: "medium",
      title: "Printer rejected",
      message: `${partner.companyName || partner.name} • ${partner.email}`,
      meta: { partnerId: String(partner._id), status: "Suspended" }
    }).catch(() => {});

    res.status(200).json({
      id: partner._id,
      status: partner.status,
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

    const partner = order.assignedPrinter
      ? await User.findById(order.assignedPrinter).select("settings.pricing").lean()
      : null;
    const breakdown = computePartnerCostBreakdown({
      items: Array.isArray(order.items) ? order.items : [],
      partnerPricing: await getPartnerPayRate(),
      priority: (order as any).priority,
      adjustments: (order as any)?.pricing?.adjustments || []
    });
    const partnerPayout = breakdown.subtotal;
    const margin = order.pricing.total - partnerPayout;

    res.status(200).json({
      customerCharge: Number(order.pricing.total.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      currency: order.pricing.currency
    });
  } catch (error) {
    next(error);
  }
};


export const getOrderFinancials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "settings.pricing")
      .lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const customerCharge = order.pricing?.total || 0;

    // The assigned partner's own negotiated rates, via the same function that
    // drives real payouts. This used to assume a flat $3.50/sq ft regardless of
    // partner, so the financials panel disagreed with what was actually paid.
    const derivable = canDerivePartnerEarning(order);
    const breakdown = derivable
      ? getOrderPartnerCostBreakdown(order, await getPartnerPayRate())
      : null;
    const partnerPayout = breakdown ? breakdown.subtotal : null;
    const margin = partnerPayout === null ? null : customerCharge - partnerPayout;

    res.status(200).json({
      customerCharge: Number(customerCharge.toFixed(2)),
      partnerPayout: partnerPayout === null ? null : Number(partnerPayout.toFixed(2)),
      margin: margin === null ? null : Number(margin.toFixed(2)),
      // Says why the two above are absent, so the panel can explain itself
      // rather than showing a blank with no reason.
      marginUnavailableReason: derivable ? undefined : "This order has no sheet dimensions to derive a partner cost from.",
      marginRealized: isPartnerEarningRealized(order),
      priority: (order as any).priority || "NORMAL",
      // Broken out so an URGENT order shows what the rush actually costs
      // instead of burying it in the payout total.
      partnerCostBreakdown: breakdown
        ? {
            base: breakdown.base,
            rushFee: breakdown.rushFee,
            specialInkFee: breakdown.specialInkFee,
            ratePerSqFt: breakdown.appliedRatePerSqFt,
            totalSqFt: breakdown.totalSqFt,
          }
        : null,
      currency: order.pricing?.currency || "USD"
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

    if (pricing.adjustments && pricing.adjustments.length > 0) {
      pricing.adjustments.forEach(adj => {
        const label = adj.type.charAt(0).toUpperCase() + adj.type.slice(1);
        const amount = (adj.type === "discount" || adj.type === "credit") ? -adj.amount : adj.amount;
        lineItems.push({ label: `${label} (${adj.reason})`, amount: amount.toFixed(2) });
      });
    }

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

export const getOrderTimeline = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName")
      .lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }
 
    let events: any[] = [];

    events.push({
      time: order.createdAt,
      who: "Customer",
      type: "Created",
      message: "Order placed"
    });

    if (order.statusTimeline && order.statusTimeline.length > 0) {
      order.statusTimeline.forEach(entry => {
        let who = "System";
        let message = `Status updated to ${entry.status}`;

        if (entry.status === "PROCESSING" && order.assignedPrinter) {
          who = "Admin";
          message = `Assigned to ${(order.assignedPrinter as unknown as IUser).companyName}`;
        } else if (["PRINTING", "QUALITY_CHECK"].includes(entry.status)) {
          who = "Printer";
        }

        events.push({
          time: entry.time,
          who,
          type: entry.status.charAt(0).toUpperCase() + entry.status.slice(1).toLowerCase(),
          message
        });
      });
    }

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

    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    res.status(200).json({ events });

  } catch (error) {
    next(error);
  }
};

export const getEarningsSummary = async (req: Request, res: Response, next: NextFunction) => {
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

    const orders = await Order.find({
      createdAt: { $gte: startDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    }).populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions settings.pricing");

    const priorOrders = await Order.find({
      createdAt: { $gte: priorStartDate, $lt: priorEndDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    });

    // Cost = what we pay the partner. Use the SAME canonical breakdown as the
    // order-financials view and the payout system so every screen agrees. Look
    // up each assigned partner's pricing once.
    const partnerIds = Array.from(
      new Set(
        [...orders, ...priorOrders]
          .map((o: any) => (o.assignedPrinter?._id ? String(o.assignedPrinter._id) : o.assignedPrinter ? String(o.assignedPrinter) : null))
          .filter(Boolean) as string[]
      )
    );
    const payRate = await getPartnerPayRate();
    const partnerDocs = partnerIds.length
      ? await User.find({ _id: { $in: partnerIds } }).select("_id").lean()
      : [];
    const partnerPricingMap = new Map<string, any>(
      // Every partner maps to the same rate now; the map is kept so the payout
      // draft's shape does not change.
      partnerDocs.map((p: any) => [String(p._id), payRate])
    );

    const calcOrderPartnerCost = (o: any): number => {
      const pid = o.assignedPrinter?._id
        ? String(o.assignedPrinter._id)
        : o.assignedPrinter
          ? String(o.assignedPrinter)
          : null;
      const pricing = pid ? partnerPricingMap.get(pid) || {} : {};
      return computePartnerCostBreakdown({
        items: Array.isArray(o.items) ? o.items : [],
        partnerPricing: pricing,
        priority: o.priority,
        adjustments: o.pricing?.adjustments || [],
      }).subtotal;
    };

    // Per-item cost approximation for the product-level table (kept aligned to the
    // canonical default rate so it stays in the same ballpark as the KPI costs).
    const DEFAULT_RATE_PER_SQFT = 2.5;
    const calculateItemCost = (item: any) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        return areaSqFt * DEFAULT_RATE_PER_SQFT * quantity;
      }
      return DEFAULT_RATE_PER_SQFT * quantity;
    };

    const calculateTotals = (orderList: any[]) => {
      let revenue = 0;
      let cost = 0;

      orderList.forEach(o => {
        revenue += (o.pricing?.total || 0);
        cost += calcOrderPartnerCost(o);
      });

      return { revenue, cost, profit: revenue - cost };
    };

    const currentTotals = calculateTotals(orders);
    const priorTotals = calculateTotals(priorOrders);

    const calculateTrend = (curr: number, prior: number) => {
      if (prior === 0) return curr > 0 ? 100 : 0;
      return Number(((curr - prior) / prior * 100).toFixed(1));
    };

    const regionMap: { [key: string]: number } = {};
    orders.forEach(o => {
      const region = (o.assignedPrinter as unknown as IUser)?.regions?.[0] || "Unknown";
      regionMap[region] = (regionMap[region] || 0) + (o.pricing?.total || 0);
    });
    const revenueByRegion = Object.entries(regionMap).map(([region, value]) => ({
      region,
      value: Number(value.toFixed(0)),
      percentage: Number(((value / (currentTotals.revenue || 1)) * 100).toFixed(0))
    })).sort((a, b) => b.value - a.value);

    const productMap: { [key: string]: any } = {};
    orders.forEach(o => {
      o.items.forEach((item: any) => {
        const key = item.name || "Custom Print";
        if (!productMap[key]) {
          productMap[key] = {
            name: key,
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

    const getTimeLabel = (date: Date) => {
      if (range === "7d") return date.toLocaleDateString("en-US", { weekday: "short" });
      if (range === "ytd") return date.toLocaleDateString("en-US", { month: "short" });
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const currentPointsMap: { [key: string]: number } = {};
    const priorPointsMap: { [key: string]: number } = {};

    orders.forEach(o => {
      const label = getTimeLabel(o.createdAt);
      currentPointsMap[label] = (currentPointsMap[label] || 0) + (o.pricing?.total || 0);
    });

    priorOrders.forEach(o => {
      const label = getTimeLabel(o.createdAt);
      priorPointsMap[label] = (priorPointsMap[label] || 0) + (o.pricing?.total || 0);
    });

    const labels: string[] = [];
    let tempDate = new Date(startDate);
    const endChartDate = new Date(now);
    
    while (tempDate <= endChartDate) {
      labels.push(getTimeLabel(tempDate));
      if (range === "7d") {
        tempDate.setDate(tempDate.getDate() + 1);
      } else if (range === "90d") {
        tempDate.setDate(tempDate.getDate() + 7); 
      } else if (range === "ytd") {
        tempDate.setMonth(tempDate.getMonth() + 1);
      } else {
        tempDate.setDate(tempDate.getDate() + 2); 
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

export const getPartnerAssignmentSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await Settings.findOne({ key: "partnerAssignment" }).lean();
    const value = (settings as any)?.value || {};

    res.json({
      assignmentRule: value.rule || "nearest-region",
      maxJobsEnabled: value.maxJobsEnabled !== false,
      maxJobsValue: value.maxJobsValue || 10,
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
    const settingValue = {
      rule: assignmentRule,
      maxJobsEnabled: maxJobsEnabled !== false,
      maxJobsValue: maxJobsEnabled ? Math.max(1, parseInt(maxJobsValue, 10)) : null,
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
