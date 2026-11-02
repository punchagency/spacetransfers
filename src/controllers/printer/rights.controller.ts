import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Order } from "../../models/order.model.js";
import { User } from "../../models/user.model.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { publishOrderEvent } from "../../services/orderSyncHub.js";
import { CustomError } from "./shared.js";

/**
 * A partner's concern that a job's artwork infringes someone's rights. The job
 * is held, with no status change and no label, until an admin clears it or
 * cancels the order: a print shop shouldn't have to print what it believes it
 * mustn't.
 */
export const reportRightsConcern = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.jobId || "");
    if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error("Job not found") as CustomError, { statusCode: 404 });
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
    if (note.length < 10) {
      throw Object.assign(new Error("Say what concerns you about the artwork (at least a sentence).") as CustomError, { statusCode: 400 });
    }
    const printer = await User.findById(req.user?.id).select("companyName name").lean();
    const name = String((printer as any)?.companyName || (printer as any)?.name || "Partner");
    const order = await Order.findOneAndUpdate(
      {
        _id: id,
        assignedPrinter: new mongoose.Types.ObjectId(String(req.user?.id)),
        status: { $nin: ["SHIPPED", "COMPLETED", "CANCELLED"] },
        "rightsConcern.status": { $ne: "open" },
      },
      { $set: { rightsConcern: { status: "open", note, reportedById: req.user?.id, reportedByName: name, at: new Date() } } },
      { new: true },
    );
    if (!order) {
      throw Object.assign(new Error("A concern can only be raised on your own job before it ships, once at a time.") as CustomError, { statusCode: 409 });
    }
    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: "Partner raised a rights concern",
      message: `${name} put ${order.displayId} on hold: ${note}`.slice(0, 280),
      meta: { orderId: String(order._id), type: "rights_concern" },
    }).catch(() => {});
    publishOrderEvent(String(order._id), "order.updated", { orderId: String(order._id), updatedAt: new Date() });
    res.json({ concern: order.rightsConcern });
  } catch (error) {
    next(error);
  }
};
