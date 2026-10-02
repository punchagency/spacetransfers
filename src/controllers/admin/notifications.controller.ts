import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { User, UserRoles } from "../../models/user.model.js";
import { AdminNotification } from "../../models/adminNotification.model.js";
import {
  addAdminNotificationClient,
  publishAdminNotificationEvent,
  removeAdminNotificationClient,
} from "../../services/adminNotificationsHub.js";
import { CustomError } from "./shared.js";

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
