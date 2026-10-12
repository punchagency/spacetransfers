import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Order } from "../../models/order.model.js";
import { OrderIssue } from "../../models/orderIssue.model.js";
import { User } from "../../models/user.model.js";
import { cleanIssueText, issueForAdmin, resolutionMessage } from "../../services/orderIssue.service.js";
import { refundOrderPayment, refundableAmount } from "../../services/orderRefund.service.js";
import { createReprintOrder } from "../../services/orderReprint.service.js";
import { notifyPrinter } from "../../services/printerNotifications.service.js";
import { publishOrderEvent } from "../../services/orderSyncHub.js";
import { sendIssueReplyEmail, sendIssueResolvedEmail } from "../../services/orderEmails.service.js";
import { CustomError } from "./shared.js";

const fail = (message: string, statusCode: number) => Object.assign(new Error(message) as CustomError, { statusCode });

const actorOf = async (req: Request) => {
  const admin = await User.findById(req.user?.id).select("name email").lean();
  return { id: String(req.user?.id || ""), name: String((admin as any)?.name || (admin as any)?.email || "Admin") };
};

const findIssue = async (req: Request) => {
  const issueId = String(req.params.issueId || "");
  const issue = mongoose.Types.ObjectId.isValid(issueId) ? await OrderIssue.findById(issueId) : null;
  if (!issue) throw fail("Report not found", 404);
  return issue;
};

/** Who is on each side of a report, for the admin's list and thread headings. */
const withPeople = async (issues: any[]) => {
  const orders = await Order.find({ _id: { $in: issues.map((i) => i.order) } })
    .select("customer status pricing.total payment assignedPrinter")
    .lean();
  const orderById = new Map(orders.map((o: any) => [String(o._id), o]));
  const partnerIds = Array.from(new Set(issues.map((i) => (i.partner ? String(i.partner) : "")).filter(Boolean)));
  const partners = partnerIds.length ? await User.find({ _id: { $in: partnerIds } }).select("name companyName").lean() : [];
  const partnerName = new Map(partners.map((p: any) => [String(p._id), String(p.companyName || p.name || "Partner")]));

  return issues.map((issue) => {
    const order: any = orderById.get(String(issue.order));
    return {
      ...issueForAdmin(issue),
      customerName: `${order?.customer?.firstName || ""} ${order?.customer?.lastName || ""}`.trim() || "Customer",
      customerEmail: String(order?.customer?.email || ""),
      partnerName: issue.partner ? partnerName.get(String(issue.partner)) || "Partner" : null,
      orderStatus: String(order?.status || ""),
      orderTotal: Number(order?.pricing?.total) || 0,
      refundable: order ? refundableAmount(order) : 0,
    };
  });
};

/** Every report, the ones waiting on the admin first. */
export const listIssues = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = String(req.query.status || "open").toLowerCase();
    const query: Record<string, unknown> = status === "all" ? {} : { status: status === "resolved" ? "RESOLVED" : "OPEN" };
    const [issues, open, waiting] = await Promise.all([
      OrderIssue.find(query).sort({ status: 1, needsAdmin: -1, updatedAt: -1 }).limit(200).lean(),
      OrderIssue.countDocuments({ status: "OPEN" }),
      OrderIssue.countDocuments({ status: "OPEN", needsAdmin: true }),
    ]);
    res.json({ issues: await withPeople(issues), counts: { open, waiting } });
  } catch (error) {
    next(error);
  }
};

/** How many reports are open, for the badge in the navigation. */
export const getIssueCounts = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [open, waiting] = await Promise.all([
      OrderIssue.countDocuments({ status: "OPEN" }),
      OrderIssue.countDocuments({ status: "OPEN", needsAdmin: true }),
    ]);
    res.json({ open, waiting });
  } catch (error) {
    next(error);
  }
};

/** The reports on one order, for its page. */
export const listIssuesForOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.orderId || "");
    const issues = mongoose.Types.ObjectId.isValid(orderId) ? await OrderIssue.find({ order: orderId }).sort({ createdAt: -1 }).lean() : [];
    res.json({ issues: await withPeople(issues) });
  } catch (error) {
    next(error);
  }
};

/** The admin writes to the customer or to the partner. */
export const postIssueMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const issue = await findIssue(req);
    const channel = String(req.body?.channel || "").toUpperCase();
    if (channel !== "CUSTOMER" && channel !== "PARTNER") throw fail("Choose who the message is for.", 400);
    const { text, error } = cleanIssueText(req.body?.body, { required: true });
    if (error) throw fail(error, 400);

    const order = await Order.findById(issue.order).lean();
    if (!order) throw fail("Order not found", 404);
    if (channel === "PARTNER") {
      // The partner who has the order now is the one to ask, if none was recorded.
      if (!issue.partner && (order as any).assignedPrinter) issue.partner = (order as any).assignedPrinter;
      if (!issue.partner) throw fail("No partner has handled this order, so there is nobody to message.", 409);
    }

    const actor = await actorOf(req);
    issue.messages.push({ channel, author: "ADMIN", authorName: actor.name, body: text, at: new Date() });
    issue.needsAdmin = false;
    if (channel === "CUSTOMER") issue.customerUnread = true;
    await issue.save();

    let customerNotified = false;
    if (channel === "CUSTOMER") {
      customerNotified = Boolean((await sendIssueReplyEmail(order, text))?.sent);
    } else {
      notifyPrinter({
        printerId: String(issue.partner),
        category: "orders",
        priority: "high",
        title: `Question about order ${issue.displayId}`,
        message: text.slice(0, 200),
        meta: { orderId: String(issue.order), issueId: String(issue._id) },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }

    const [payload] = await withPeople([issue.toObject()]);
    res.json({ issue: payload, customerNotified });
  } catch (error) {
    next(error);
  }
};

/**
 * Settles a report: a refund of the amount chosen, a free reprint, or neither.
 * The money or the new order comes first, and the report is closed only once
 * that has worked, so it never reads "refunded" over a refund that failed.
 */
export const resolveIssue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const issue = await findIssue(req);
    if (issue.status === "RESOLVED") throw fail("This report is already resolved.", 409);
    const outcome = String(req.body?.outcome || "").toUpperCase();
    if (outcome !== "REFUND" && outcome !== "REPRINT" && outcome !== "NONE") throw fail("Choose how to resolve this.", 400);
    const { text: note, error } = cleanIssueText(req.body?.note, { required: outcome !== "REPRINT" });
    if (error) throw fail(outcome === "REFUND" ? "A reason is required for a refund." : "Tell the customer how this was resolved.", 400);

    const order = await Order.findById(issue.order).lean();
    if (!order) throw fail("Order not found", 404);
    const actor = await actorOf(req);

    let refundAmount: number | undefined;
    let reprint: { orderId: string; displayId: string } | undefined;
    if (outcome === "REFUND") {
      const result = await refundOrderPayment(order, actor, { amount: Number(req.body?.refundAmount), reason: note });
      refundAmount = result.amount;
      publishOrderEvent(String(order._id), "order.financials.changed", { orderId: String(order._id), updatedAt: new Date() });
    } else if (outcome === "REPRINT") {
      reprint = await createReprintOrder(order, actor, note);
    }

    const now = new Date();
    issue.messages.push({
      channel: "CUSTOMER",
      author: "ADMIN",
      authorName: actor.name,
      body: resolutionMessage(outcome, note, { refundAmount, reprintDisplayId: reprint?.displayId }),
      at: now,
    });
    issue.status = "RESOLVED";
    issue.needsAdmin = false;
    issue.customerUnread = true;
    issue.resolution = {
      outcome,
      note,
      refundAmount,
      reprintOrderId: reprint?.orderId,
      reprintDisplayId: reprint?.displayId,
      at: now,
      byId: actor.id,
      byName: actor.name,
    };
    await issue.save();

    const mail = await sendIssueResolvedEmail(order, { kind: outcome, note, refundAmount, reprintDisplayId: reprint?.displayId });

    const [payload] = await withPeople([issue.toObject()]);
    res.json({ issue: payload, reprint: reprint || null, customerNotified: Boolean(mail?.sent) });
  } catch (error) {
    next(error);
  }
};
