import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { OrderIssue } from "../../models/orderIssue.model.js";
import { User } from "../../models/user.model.js";
import { cleanIssueText, issueForPartner, partnerCanSeeIssue } from "../../services/orderIssue.service.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { CustomError } from "./shared.js";

const fail = (message: string, statusCode: number) => Object.assign(new Error(message) as CustomError, { statusCode });

/** The problems on one job that the admin has written to this partner about. */
export const listJobIssues = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.orderId || "");
    const partnerId = String(req.user?.id || "");
    const issues = mongoose.Types.ObjectId.isValid(orderId)
      ? await OrderIssue.find({ order: orderId, partner: partnerId }).sort({ createdAt: -1 }).lean()
      : [];
    res.json({ issues: issues.filter((i) => partnerCanSeeIssue(i, partnerId)).map(issueForPartner) });
  } catch (error) {
    next(error);
  }
};

/** Every open question from the admin to this partner, the ones waiting on them first. */
export const listPartnerIssues = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partnerId = String(req.user?.id || "");
    const issues = await OrderIssue.find({ partner: partnerId, status: "OPEN" }).sort({ updatedAt: -1 }).limit(100).lean();
    const visible = issues.filter((i) => partnerCanSeeIssue(i, partnerId)).map(issueForPartner);
    visible.sort((a, b) => Number(b.awaitingReply) - Number(a.awaitingReply));
    res.json({
      issues: visible.map(({ messages, ...issue }) => ({ ...issue, lastMessage: messages[messages.length - 1]?.body || "" })),
      awaitingReply: visible.filter((i) => i.awaitingReply).length,
    });
  } catch (error) {
    next(error);
  }
};

/** The partner's answer to the admin. */
export const replyToJobIssue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const issueId = String(req.params.issueId || "");
    const partnerId = String(req.user?.id || "");
    const issue = mongoose.Types.ObjectId.isValid(issueId) ? await OrderIssue.findById(issueId) : null;
    if (!issue || !partnerCanSeeIssue(issue, partnerId)) throw fail("Not found", 404);
    const { text, error } = cleanIssueText(req.body?.body, { required: true });
    if (error) throw fail(error, 400);

    const partner = await User.findById(partnerId).select("name companyName email").lean();
    const name = String((partner as any)?.companyName || (partner as any)?.name || (partner as any)?.email || "Partner");
    issue.messages.push({ channel: "PARTNER", author: "PARTNER", authorName: name, body: text, at: new Date() });
    issue.needsAdmin = true;
    await issue.save();

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: `Partner replied on ${issue.displayId}`,
      message: `${name}: ${text.slice(0, 160)}`,
      meta: { orderId: String(issue.order), issueId: String(issue._id) },
    }).catch(() => {});

    res.json({ issue: issueForPartner(issue.toObject()) });
  } catch (error) {
    next(error);
  }
};
