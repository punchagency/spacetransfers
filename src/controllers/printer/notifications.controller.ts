import { Request, Response, NextFunction } from "express";
import { PrinterNotification } from "../../models/printerNotification.model.js";
import {
  addPrinterNotificationClient,
  publishPrinterNotificationEvent,
  removePrinterNotificationClient,
} from "../../services/printerNotificationsHub.js";
import mongoose from "mongoose";

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
