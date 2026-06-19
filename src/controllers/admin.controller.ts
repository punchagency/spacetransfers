import { Request, Response, NextFunction } from "express";
import { getRegionFromState, normalizeRegion } from "../utils/region.js";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { generatePDF } from "pdf-node";
import { Order, IOrder } from "../models/order.model.js";
import { User, UserRoles, IUser } from "../models/user.model.js";
import { Settings } from "../models/settings.model.js";
import { Design } from "../models/design.model.js";
import { AdminNotification } from "../models/adminNotification.model.js";
import { addAdminNotificationClient, publishAdminNotificationEvent, removeAdminNotificationClient } from "../services/adminNotificationsHub.js";
import { notifyAllAdmins } from "../services/adminNotifications.service.js";
import { notifyPrinter } from "../services/printerNotifications.service.js";
import { exportGangsheetPng24 } from "../services/gangsheetExport.service.js";
import { env } from "../config/env.js";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";

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

    let trendPct = 0;
    if (priorRevenue > 0) {
      trendPct = ((currentRevenue - priorRevenue) / priorRevenue) * 100;
    } else if (currentRevenue > 0) {
      trendPct = 100;
    }

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
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions");

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

        const calculateOrderFinancials = (order: Pick<IOrder, "pricing" | "items">) => {
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
          trendPct: Number(trendPct.toFixed(1))
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
      return res.status(200).json({
        baseRatePerSqFt: 24.00,
        shipping: {
          standard: 8.99,
          express: 24.99
        },
        taxRatePct: 8.0
      });
    }

    res.status(200).json(settings.value);
  } catch (error) {
    next(error);
  }
};

export const updateGlobalPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { baseRatePerSqFt, shipping, taxRatePct } = req.body;

    const settings = await Settings.findOneAndUpdate(
      { key: "global_pricing" },
      {
        $set: {
          value: {
            baseRatePerSqFt,
            shipping,
            taxRatePct
          }
        }
      },
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
          { createdAt: new Date(createdAtMs), _id: { $lt: new mongoose.Types.ObjectId(idRaw) } }
        ];
      }
    }

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

    const security = admin.settings?.security || { twoFactorEnabled: false };

    res.status(200).json({
       twoFactorEnabled: security.twoFactorEnabled || false,
       lastPasswordChange: security.lastPasswordChange || admin.updatedAt || new Date()
     });
   } catch (error) {
     next(error);
   }
 };
 
 export const updateAdminSecuritySettings = async (req: Request, res: Response, next: NextFunction) => {
   try {
     const adminId = req.user?.id;
     const { twoFactorEnabled } = req.body;
 
     if (twoFactorEnabled === undefined) {
       const error = new Error("twoFactorEnabled is required") as CustomError;
       error.statusCode = 400;
       throw error;
     }
 
     const admin = await User.findById(adminId);
     if (!admin) {
       const error = new Error("Admin not found") as CustomError;
       error.statusCode = 404;
       throw error;
     }
 
    if (!admin.settings) admin.settings = { pricing: { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } }, security: { twoFactorEnabled: false } };
     if (!admin.settings.security) admin.settings.security = { twoFactorEnabled: false };
 
     const previous2FA = admin.settings.security.twoFactorEnabled;
     admin.settings.security.twoFactorEnabled = twoFactorEnabled;
 
     admin.markModified("settings.security");
     await admin.save();
 
     if (twoFactorEnabled && !previous2FA) {
       const mockQrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=otpauth://totp/SpaceTransfers:${admin.email}?secret=MOCKSECRET&issuer=SpaceTransfers`;
       console.log(`[TOTP MOCK] Setup flow initiated for ${admin.email}. QR Code URL sent: ${mockQrCodeUrl}`);
     }
 
     res.status(200).json({ updated: true });
   } catch (error) {
     next(error);
   }
 };

export const getAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId).select("name email phone avatarUrl defaultShippingAddress settings.profile");

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
      profile: {
        bio: admin.settings?.profile?.bio || "",
        gender: admin.settings?.profile?.gender || "",
        dateOfBirth: admin.settings?.profile?.dateOfBirth || "",
        nationalId: admin.settings?.profile?.nationalId || "",
        taxId: admin.settings?.profile?.taxId || ""
      },
      address: admin.defaultShippingAddress || {
        street: "",
        city: "",
        state: "",
        postalCode: "",
        country: ""
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const { name, email, phone, avatarUrl, profile, address } = req.body;

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
      admin.avatarUrl = avatarUrl === null ? null : String(avatarUrl);
      didUpdate = true;
    }

    if (profile !== undefined && profile && typeof profile === "object") {
      if (!admin.settings) (admin as any).settings = {};
      if (!admin.settings.profile) (admin.settings as any).profile = {};

      if (profile.bio !== undefined) (admin.settings.profile as any).bio = String(profile.bio || "");
      if (profile.gender !== undefined) (admin.settings.profile as any).gender = String(profile.gender || "");
      if (profile.dateOfBirth !== undefined) (admin.settings.profile as any).dateOfBirth = String(profile.dateOfBirth || "");
      if (profile.nationalId !== undefined) (admin.settings.profile as any).nationalId = String(profile.nationalId || "");
      if (profile.taxId !== undefined) (admin.settings.profile as any).taxId = String(profile.taxId || "");
      admin.markModified("settings.profile");
      didUpdate = true;
    }

    if (address !== undefined && address && typeof address === "object") {
      admin.defaultShippingAddress = {
        street: String(address.street || ""),
        city: String(address.city || ""),
        state: String(address.state || ""),
        postalCode: String(address.postalCode || ""),
        country: String(address.country || "")
      };
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
      const error = new Error("Current password is incorrect") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    if (!admin.settings) {
      admin.settings = {
        pricing: { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } },
        security: { twoFactorEnabled: false }
      };
    }
    if (!admin.settings.security) admin.settings.security = { twoFactorEnabled: false };
    admin.settings.security.lastPasswordChange = new Date();
    admin.markModified("settings.security");
    await admin.save();

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
      search,
      cursor,
      limit = "20"
    } = req.query;

    const query: any = {};
    // Extra compound filters that can't be merged directly into query
    const extraFilters: any[] = [];

    if (status) {
      const statusMap: { [key: string]: string } = {
        "Pending": "PENDING",
        "Assigned": "PENDING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status as string] || (status as string).toUpperCase();
    }

    if (partnerId) {
      query.assignedPrinter = partnerId;
    }

    if (search) {
      const searchRegex = new RegExp((search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const searchOr: any[] = [
        { "customer.firstName": searchRegex },
        { "customer.lastName": searchRegex },
        { "customer.email": searchRegex }
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
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions")
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

    const formattedOrders = results.map(order => {
      const firstItem = order.items?.[0] || {};
      const sheetSize = firstItem.widthIn && firstItem.heightIn 
        ? `${firstItem.widthIn}" x ${firstItem.heightIn}"`
        : "N/A";

      const customerCharge = order.pricing?.total || 0;
      const partnerPayout = (order.items || []).reduce((total: number, item: any) => {
        const widthIn = Number(item.widthIn || 0);
        const heightIn = Number(item.heightIn || 0);
        const quantity = Number(item.quantity || 1);
        if (widthIn > 0 && heightIn > 0) {
          const areaSqFt = (widthIn * heightIn) / 144;
          return total + (areaSqFt * 3.5 * quantity);
        }
        return total;
      }, 0);
      const processingFees = customerCharge * 0.05;
      const profits = customerCharge - partnerPayout - processingFees;
  
      return {
        id: order._id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        profits: Number(profits.toFixed(2)),
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
        region: resolveOrderRegion(order, userRegionMap)
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

export const getPartnerPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("settings.pricing")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const pricing = partner.settings?.pricing || {
      baseRatePerSqFt: 2.5,
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

export const updatePartnerPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { baseRatePerSqFt, tiered, surcharges } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const updateData: any = {};
    if (baseRatePerSqFt !== undefined) updateData["settings.pricing.baseRatePerSqFt"] = baseRatePerSqFt;
    if (tiered !== undefined) updateData["settings.pricing.tiered"] = tiered;
    if (surcharges !== undefined) updateData["settings.pricing.surcharges"] = surcharges;

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("settings.pricing").lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
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

    const statusMap: { [key: string]: string } = {
      "Pending": "PENDING",
      "Assigned": "PENDING",
      "In Progress": "PRINTING",
      "Shipped": "SHIPPED",
      "Completed": "COMPLETED",
      "Cancelled": "CANCELLED"
    };

    const dbStatus = statusMap[status] as any;
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

    const { partnerId, priority = "Normal", force = false } = req.body;

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

    order.assignedPrinter = partnerId;
    order.priority = priority.toUpperCase() as any;
    if (["PENDING", "PROCESSING"].includes(String(order.status || "").toUpperCase())) {
      order.status = "PENDING";
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
      partnerPricing: (partner as any)?.settings?.pricing || {},
      priority: (order as any).priority,
      adjustments: (order as any)?.pricing?.adjustments || []
    });
    const totalPartnerCost = breakdown.subtotal;

    const customerPaid = order.pricing?.total || 0;
    const processingFees = customerPaid > 0 ? (customerPaid * 0.029) + 0.30 : 0;
    const adminProfit = customerPaid - totalPartnerCost - processingFees;

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
        partnerCost: Number(totalPartnerCost.toFixed(2)),
        processingFees: Number(processingFees.toFixed(2)),
        adminProfit: Number(adminProfit.toFixed(2)),
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

    const requestedResolution = Math.max(72, Math.min(300, parseInt(req.query.resolution as string) || 72));

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

    const sheetWidthIn = typeof gangsheetItem.sheetWidthIn === "number" && Number.isFinite(gangsheetItem.sheetWidthIn)
      ? gangsheetItem.sheetWidthIn : typeof gangsheetItem.widthIn === "number" && Number.isFinite(gangsheetItem.widthIn)
      ? gangsheetItem.widthIn : 23.5;
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
      maxComposites: 10000,
      format: "webp",
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
      const statusMap: { [key: string]: string } = {
        "Pending": "PENDING",
        "Assigned": "PENDING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status as string] || (status as string).toUpperCase();
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

    if (!resolvedContactName) {
      const error = new Error("contactName is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (typeof email !== "string" || !email.trim()) {
      const error = new Error("email is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (typeof phone !== "string" || !phone.trim()) {
      const error = new Error("phone is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!Array.isArray(regions) || regions.length === 0) {
      const error = new Error("regions must be a non-empty array") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error("Partner with this email already exists") as CustomError;
      error.statusCode = 409;
      throw error;
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const allowedStatuses = ["Active", "Pending", "Suspended", "Under Review"];
    const resolvedStatus = (typeof status === "string" && allowedStatuses.includes(status)) ? status : "Pending";

    const newPartner = new User({
      name: resolvedContactName,
      companyName: resolvedCompanyName,
      email: String(email).trim(),
      phone: String(phone).trim(),
      regions: regions.map((r: any) => String(r).trim()).filter(Boolean),
      role: UserRoles.PRINTER,
      status: resolvedStatus,
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

    console.log(`[EMAIL MOCK] Welcome email sent to ${email} with temporary password: ${tempPassword}`);

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
      const searchRegex = new RegExp(search as string, "i");
      matchQuery.$or = [
        { name: searchRegex },
        { companyName: searchRegex },
        { email: searchRegex }
      ];
    }

    const globalPricingSetting = await Settings.findOne({ key: "global_pricing" }).lean();
    const globalPricing = (globalPricingSetting as any)?.value;
    const saleRatePerSqFt = typeof globalPricing?.baseRatePerSqFt === "number" ? globalPricing.baseRatePerSqFt : 24.0;

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
        $addFields: {
          ordersCompleted: { $ifNull: [{ $arrayElemAt: ["$completedCountArr.count", 0] }, 0] }
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
          "settings.pricing.baseRatePerSqFt": 1
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
      basePrice: `$${Number(p.settings?.pricing?.baseRatePerSqFt ?? 18).toFixed(2)}`,
      salePrice: `$${Number(saleRatePerSqFt).toFixed(2)}`,
      profit: `$${(Number(saleRatePerSqFt) - Number(p.settings?.pricing?.baseRatePerSqFt ?? 18)).toFixed(2)}`,
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
      const statusMap: { [key: string]: string } = {
        "Pending": "PENDING",
        "Assigned": "PENDING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status as string] || (status as string).toUpperCase();
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

    const updateData = req.body;

    delete updateData.passwordHash;
    delete updateData.role;

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: updateData },
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
      partnerPricing: (partner as any)?.settings?.pricing || {},
      priority: (order as any).priority,
      adjustments: (order as any)?.pricing?.adjustments || []
    });
    const partnerPayout = breakdown.subtotal;
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

export const getOrderFinancials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString).lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const customerCharge = order.pricing?.total || 0;

    const calculateItemCost = (item: any) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    const partnerPayout = (order.items || []).reduce((total, item) => total + calculateItemCost(item), 0);
    const fees = customerCharge > 0 ? (customerCharge * 0.029) + 0.30 : 0;
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
    }).populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions");

    const priorOrders = await Order.find({
      createdAt: { $gte: priorStartDate, $lt: priorEndDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    });

    const calculateItemCost = (item: any) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    const calculateTotals = (orderList: any[]) => {
      let revenue = 0;
      let payout = 0;
      let fees = 0;
      
      orderList.forEach(o => {
        const orderRevenue = (o.pricing?.total || 0);
        revenue += orderRevenue;
        
        o.items.forEach((item: any) => {
          payout += calculateItemCost(item);
        });

        if (orderRevenue > 0) {
          fees += (orderRevenue * 0.029) + 0.30;
        }
      });

      const totalCost = payout + fees;
      return { revenue, cost: totalCost, profit: revenue - totalCost };
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
            sku: `DTF-${o._id.toString().slice(-4).toUpperCase()}`,
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
