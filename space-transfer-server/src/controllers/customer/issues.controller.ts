import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Order } from "../../models/order.model.js";
import { OrderIssue } from "../../models/orderIssue.model.js";
import { User } from "../../models/user.model.js";
import sharp from "sharp";
import { isStoredArtworkUrl, storeArtwork } from "../../services/storage.service.js";
import {
  ISSUE_ATTACHMENT_FOLDER,
  ISSUE_TYPE_LABELS,
  cleanAffectedDesigns,
  cleanIssueAttachments,
  cleanIssueText,
  issueForCustomer,
  issueReportError,
  parseIssueType,
} from "../../services/orderIssue.service.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { sendIssueReceivedEmail } from "../../services/orderEmails.service.js";
import { CustomError } from "./shared.js";
import { describeOrderDesigns } from "../../services/sheetDesigns.service.js";
import { resolveApiFile } from "../../utils/publicApiBase.js";

const fail = (message: string, statusCode: number) => Object.assign(new Error(message) as CustomError, { statusCode });

const ownOrder = async (req: Request) => {
  const orderId = String(req.params.orderId || "");
  const order = mongoose.Types.ObjectId.isValid(orderId) ? await Order.findOne({ _id: orderId, user: req.user?.id }).lean() : null;
  if (!order) throw fail("Order not found", 404);
  return order;
};

const customerName = async (req: Request, order?: any) => {
  const fromOrder = `${order?.customer?.firstName || ""} ${order?.customer?.lastName || ""}`.trim();
  if (fromOrder) return fromOrder;
  const user = await User.findById(req.user?.id).select("name email").lean();
  return String((user as any)?.name || (user as any)?.email || "Customer");
};

/**
 * Stores one photo for a report and returns where it lives. The photo is
 * turned upright, shrunk to a size that shows the damage without being a
 * print file, and re-saved, which also drops the location a phone embeds.
 */
export const uploadIssuePhoto = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file?.buffer?.length) throw fail("Choose a photo to add.", 400);
    let photo: Buffer;
    try {
      photo = await sharp(file.buffer)
        .rotate()
        .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } catch {
      throw fail("That photo couldn't be read. Please try a different one.", 400);
    }
    const stored = await storeArtwork(photo, `${ISSUE_ATTACHMENT_FOLDER}/${String(req.user?.id || "user")}`, "image/jpeg");
    res.status(201).json({ url: stored.url, name: String(file.originalname || "photo").slice(0, 120) });
  } catch (error) {
    next(error);
  }
};

/** Reports a problem with one of the customer's orders. */
export const reportOrderIssue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await ownOrder(req);
    const type = parseIssueType(req.body?.type);
    if (!type) throw fail("Choose what went wrong.", 400);
    const { text: description, error } = cleanIssueText(req.body?.description, { required: false });
    if (error) throw fail(error, 400);
    const photos = cleanIssueAttachments(req.body?.attachments, isStoredArtworkUrl);
    if (photos.error) throw fail(photos.error, 400);
    const marked = cleanAffectedDesigns(order, req.body?.affectedDesigns);
    if (marked.error) throw fail(marked.error, 400);
    const refusal = issueReportError(order, type, description);
    if (refusal) throw fail(refusal, 400);

    const open = await OrderIssue.findOne({ order: order._id, status: "OPEN" }).lean();
    if (open) throw fail("You already have an open report on this order. Add a message to it instead.", 409);

    const displayId = String((order as any).displayId || order._id);
    const issue = await OrderIssue.create({
      order: order._id,
      displayId,
      user: req.user?.id,
      partner: (order as any).assignedPrinter || null,
      type,
      description,
      attachments: photos.attachments.length ? photos.attachments : undefined,
      affectedDesigns: marked.designs.length ? marked.designs : undefined,
      status: "OPEN",
      needsAdmin: true,
      messages: [],
    });

    const name = await customerName(req, order);
    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: `Problem reported on ${displayId}`,
      message:
        `${name}: ${ISSUE_TYPE_LABELS[type]}${description ? ` — ${description.slice(0, 140)}` : ""}` +
        (photos.attachments.length ? ` (${photos.attachments.length} photo${photos.attachments.length === 1 ? "" : "s"})` : "") +
        (marked.designs.length ? ` (${marked.designs.length} design${marked.designs.length === 1 ? "" : "s"} marked)` : ""),
      meta: { orderId: String(order._id), issueId: String(issue._id) },
    }).catch(() => {});
    void sendIssueReceivedEmail(order, ISSUE_TYPE_LABELS[type], description);

    res.status(201).json({ issue: issueForCustomer(issue.toObject()) });
  } catch (error) {
    next(error);
  }
};

/** The customer's reports on one order, newest first. Opening them marks the replies read. */
export const listOrderIssues = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await ownOrder(req);
    const issues = await OrderIssue.find({ order: order._id }).sort({ createdAt: -1 }).lean();
    if (issues.some((i: any) => i.customerUnread)) {
      await OrderIssue.updateMany({ order: order._id, customerUnread: true }, { $set: { customerUnread: false } }, { timestamps: false });
    }
    res.json({ issues: issues.map(issueForCustomer) });
  } catch (error) {
    next(error);
  }
};

/** Adds the customer's message. Writing on a settled report reopens it. */
export const replyToOrderIssue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const issueId = String(req.params.issueId || "");
    const issue = mongoose.Types.ObjectId.isValid(issueId) ? await OrderIssue.findOne({ _id: issueId, user: req.user?.id }) : null;
    if (!issue) throw fail("Report not found", 404);
    const photos = cleanIssueAttachments(req.body?.attachments, isStoredArtworkUrl);
    if (photos.error) throw fail(photos.error, 400);
    // A photo on its own says enough; words are needed only without one.
    const { text, error } = cleanIssueText(req.body?.body, { required: photos.attachments.length === 0 });
    if (error) throw fail(error, 400);

    const reopened = issue.status === "RESOLVED";
    const name = await customerName(req);
    issue.messages.push({
      channel: "CUSTOMER",
      author: "CUSTOMER",
      authorName: name,
      body: text,
      attachments: photos.attachments.length ? photos.attachments : undefined,
      at: new Date(),
    });
    issue.status = "OPEN";
    issue.needsAdmin = true;
    issue.customerUnread = false;
    await issue.save();

    notifyAllAdmins({
      category: "orders",
      priority: reopened ? "high" : "medium",
      title: reopened ? `Report reopened on ${issue.displayId}` : `Customer replied on ${issue.displayId}`,
      message: `${name}: ${text.slice(0, 160) || `${photos.attachments.length} photo${photos.attachments.length === 1 ? "" : "s"}`}`,
      meta: { orderId: String(issue.order), issueId: String(issue._id) },
    }).catch(() => {});

    res.json({ issue: issueForCustomer(issue.toObject()) });
  } catch (error) {
    next(error);
  }
};

/** The designs on the order's sheets, drawn where they print, for marking the affected ones. */
export const getOrderDesigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await ownOrder(req);
    res.json({ sheets: await describeOrderDesigns(order, (v) => resolveApiFile(req, v)) });
  } catch (error) {
    next(error);
  }
};
