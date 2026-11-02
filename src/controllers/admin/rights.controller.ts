import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { RightsDispute } from "../../models/rightsDispute.model.js";
import { RightsRule } from "../../models/rightsRule.model.js";
import { RightsScreen } from "../../models/rightsScreen.model.js";
import { Order } from "../../models/order.model.js";
import { User } from "../../models/user.model.js";
import { forgetRules, judgedFindings, rightsChecks } from "../../services/rights/screening.service.js";
import { sendRightsDisputeEmail } from "../../services/orderEmails.service.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { notifyPrinter } from "../../services/printerNotifications.service.js";
import { publishOrderEvent } from "../../services/orderSyncHub.js";
import { CustomError } from "./shared.js";

/**
 * Admins' side of the rights check: the dispute queue, decisions, and the rules
 * applied on top of the automatic checks.
 *
 * Every decision needs a written reason, and is recorded with who made it and
 * when. An approval names the findings it covers and holds for that customer
 * only. A rejection, by default, also blocks the image for everyone, so it
 * can't simply be uploaded again by another account. Customers whose disputes
 * keep being rejected are brought to the admins' attention, as the repeat
 * infringer policy requires.
 */

const fail = (message: string, statusCode: number) => Object.assign(new Error(message) as CustomError, { statusCode });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const adminName = (req: Request) => String((req.user as any)?.name || (req.user as any)?.email || "Admin");
const REPEAT_REJECTIONS = 3;

const rejectionsFor = (user: unknown) => RightsDispute.countDocuments({ user, status: "rejected" });

const adminView = async (d: any, withDetail = false) => {
  const customer = await User.findById(d.user).select("email name status").lean();
  return {
    id: String(d._id),
    status: d.status,
    awaitingAdmin: Boolean(d.awaitingAdmin),
    imageUrl: d.imageUrl,
    imageName: d.imageName || null,
    findings: d.findings || [],
    customer: { id: String(d.user), email: (customer as any)?.email || "", name: (customer as any)?.name || "", status: (customer as any)?.status || "" },
    lastMessage: d.messages?.length ? d.messages[d.messages.length - 1] : null,
    decision: d.decision || null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...(withDetail
      ? {
          messages: d.messages || [],
          rejections: await rejectionsFor(d.user),
          // What the checks see in the image now, rules included, for the admin's judgement.
          screen: await RightsScreen.findById(d.screen)
            .lean()
            .then((s: any) => (s ? { checks: s.checks, failed: s.failed, findings: judgedFindings(s, { images: [], terms: [] }) } : null)),
        }
      : {}),
  };
};

export const rightsSummary = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [openDisputes, waiting, openConcerns, rules] = await Promise.all([
      RightsDispute.countDocuments({ status: "open" }),
      RightsDispute.countDocuments({ status: "open", awaitingAdmin: true }),
      Order.countDocuments({ "rightsConcern.status": "open" }),
      RightsRule.countDocuments({}),
    ]);
    res.json({ checks: { metadata: true, imageMatching: true, ...rightsChecks() }, openDisputes, waiting, openConcerns, rules });
  } catch (error) {
    next(error);
  }
};

export const listDisputes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const decided = req.query.status === "decided";
    const list = await RightsDispute.find(decided ? { status: { $in: ["approved", "rejected", "withdrawn"] } } : { status: "open" })
      // Customers waiting on an answer first.
      .sort(decided ? { updatedAt: -1 } : { awaitingAdmin: -1, updatedAt: 1 })
      .limit(200)
      .lean();
    res.json({ disputes: await Promise.all(list.map((d) => adminView(d))) });
  } catch (error) {
    next(error);
  }
};

const findDispute = async (req: Request) => {
  const id = String(req.params.disputeId || "");
  if (!mongoose.isValidObjectId(id)) throw fail("Dispute not found", 404);
  const d = await RightsDispute.findById(id);
  if (!d) throw fail("Dispute not found", 404);
  return d;
};

export const getDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ dispute: await adminView((await findDispute(req)).toObject(), true) });
  } catch (error) {
    next(error);
  }
};

const customerEmail = async (d: any) => String(((await User.findById(d.user).select("email").lean()) as any)?.email || "");

export const replyToDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = await findDispute(req);
    const body = text(req.body?.message, 4000);
    if (!body) throw fail("Write a message first.", 400);
    d.messages.push({ author: "ADMIN", authorName: adminName(req), body, attachments: [], at: new Date() });
    d.awaitingAdmin = false;
    await d.save();
    void sendRightsDisputeEmail(await customerEmail(d), "A reply about your artwork", "A reply about your artwork", [
      `Space Transfers replied about ${d.imageName ? `“${d.imageName}”` : "an image"} you disputed.`,
    ], body);
    res.json({ dispute: await adminView(d.toObject(), true) });
  } catch (error) {
    next(error);
  }
};

const requireReason = (v: unknown) => {
  const note = text(v, 2000);
  if (note.length < 10) throw fail("Write the reason for the decision (at least a sentence). It's kept with the decision.", 400);
  return note;
};

export const approveDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = await findDispute(req);
    if (d.status !== "open") throw fail(`This dispute is already ${d.status}.`, 409);
    const note = requireReason(req.body?.note);
    const disputable = (d.findings || []).filter((f) => f.severity !== "info").map((f) => f.id);
    const chosen: string[] = Array.isArray(req.body?.findings) ? req.body.findings.filter((f: unknown) => typeof f === "string") : disputable;
    const approvedFindings = chosen.filter((f) => disputable.includes(f));
    if (!approvedFindings.length) throw fail("Choose what the customer is cleared to print.", 400);
    d.status = "approved";
    d.awaitingAdmin = false;
    d.decision = { byId: new mongoose.Types.ObjectId(String(req.user?.id)), byName: adminName(req), at: new Date(), note, approvedFindings };
    d.messages.push({ author: "ADMIN", authorName: adminName(req), body: `Approved: ${note}`, attachments: [], at: new Date() });
    await d.save();
    const labels = (d.findings || []).filter((f) => approvedFindings.includes(f.id)).map((f) => f.label);
    void sendRightsDisputeEmail(await customerEmail(d), "Your artwork was approved", "Your artwork was approved", [
      `You're cleared to print ${labels.join(", ")}. You can check out now.`,
    ], note);
    res.json({ dispute: await adminView(d.toObject(), true) });
  } catch (error) {
    next(error);
  }
};

const blockImage = async (d: any, req: Request, note: string) => {
  const screen = await RightsScreen.findById(d.screen).select("dhash").lean();
  if (!(screen as any)?.dhash) return;
  const exists = await RightsRule.findOne({ kind: "image", dhash: (screen as any).dhash });
  if (exists) return;
  await RightsRule.create({
    kind: "image",
    dhash: (screen as any).dhash,
    imageUrl: d.imageUrl,
    note,
    addedById: req.user?.id,
    addedByName: adminName(req),
    dispute: d._id,
  });
  forgetRules();
};

export const rejectDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = await findDispute(req);
    if (d.status !== "open") throw fail(`This dispute is already ${d.status}.`, 409);
    const note = requireReason(req.body?.note);
    d.status = "rejected";
    d.awaitingAdmin = false;
    d.decision = { byId: new mongoose.Types.ObjectId(String(req.user?.id)), byName: adminName(req), at: new Date(), note, approvedFindings: [] };
    d.messages.push({ author: "ADMIN", authorName: adminName(req), body: `Not approved: ${note}`, attachments: [], at: new Date() });
    await d.save();
    if (req.body?.blockImage !== false) await blockImage(d, req, note);
    void sendRightsDisputeEmail(await customerEmail(d), "About the artwork you disputed", "We can't print this artwork", [
      "We weren't able to confirm your rights to print it, so it needs to be removed from your sheet before you can check out.",
    ], note);
    const rejections = await rejectionsFor(d.user);
    if (rejections >= REPEAT_REJECTIONS) {
      const customer = await User.findById(d.user).select("email").lean();
      notifyAllAdmins({
        category: "orders",
        priority: "high",
        title: "Repeated rights rejections",
        message: `${(customer as any)?.email || "A customer"} has had ${rejections} rights disputes rejected. Under the repeat infringer policy, consider suspending the account.`,
        meta: { type: "rights_dispute", disputeId: String(d._id) },
      }).catch(() => {});
    }
    res.json({ dispute: await adminView(d.toObject(), true) });
  } catch (error) {
    next(error);
  }
};

/** Withdraws an approval, for instance when a licence turns out to have lapsed. */
export const revokeApproval = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = await findDispute(req);
    if (d.status !== "approved") throw fail("Only an approved dispute can be revoked.", 409);
    const note = requireReason(req.body?.note);
    d.status = "rejected";
    d.decision = { byId: new mongoose.Types.ObjectId(String(req.user?.id)), byName: adminName(req), at: new Date(), note: `Approval revoked: ${note}`, approvedFindings: [] };
    d.messages.push({ author: "ADMIN", authorName: adminName(req), body: `Approval revoked: ${note}`, attachments: [], at: new Date() });
    await d.save();
    void sendRightsDisputeEmail(await customerEmail(d), "An artwork approval was withdrawn", "An artwork approval was withdrawn", [
      "Space Transfers has withdrawn an earlier approval, so this artwork can't be printed for now.",
    ], note);
    res.json({ dispute: await adminView(d.toObject(), true) });
  } catch (error) {
    next(error);
  }
};

export const listRules = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ rules: (await RightsRule.find({}).sort({ createdAt: -1 }).lean()).map((r: any) => ({ ...r, id: String(r._id) })) });
  } catch (error) {
    next(error);
  }
};

export const addTermRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const term = text(req.body?.term, 80);
    if (term.length < 3) throw fail("A watch term needs at least three characters.", 400);
    if (await RightsRule.findOne({ kind: "term", term: new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) {
      throw fail("That term is already watched.", 409);
    }
    const rule = await RightsRule.create({ kind: "term", term, note: text(req.body?.note, 300), addedById: req.user?.id, addedByName: adminName(req) });
    forgetRules();
    res.status(201).json({ rule: { ...rule.toObject(), id: String(rule._id) } });
  } catch (error) {
    next(error);
  }
};

export const deleteRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.ruleId || "");
    if (!mongoose.isValidObjectId(id)) throw fail("Rule not found", 404);
    const removed = await RightsRule.findByIdAndDelete(id);
    if (!removed) throw fail("Rule not found", 404);
    forgetRules();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

export const listConcerns = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const orders = await Order.find({ "rightsConcern.status": "open" }).select("displayId rightsConcern status assignedPrinter").sort({ updatedAt: 1 }).lean();
    res.json({ concerns: orders.map((o: any) => ({ orderId: String(o._id), displayId: o.displayId, status: o.status, concern: o.rightsConcern })) });
  } catch (error) {
    next(error);
  }
};

/** Clears a partner's concern so the job can go on; cancelling the order is done from the order page. */
export const resolveConcern = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.orderId || "");
    if (!mongoose.isValidObjectId(id)) throw fail("Order not found", 404);
    const note = requireReason(req.body?.note);
    const order = await Order.findOneAndUpdate(
      { _id: id, "rightsConcern.status": "open" },
      { $set: { "rightsConcern.status": "cleared", "rightsConcern.resolvedByName": adminName(req), "rightsConcern.resolvedAt": new Date(), "rightsConcern.resolution": note } },
      { new: true },
    );
    if (!order) throw fail("This order has no open rights concern.", 409);
    if (order.assignedPrinter) {
      notifyPrinter({
        printerId: String(order.assignedPrinter),
        category: "jobs",
        priority: "high",
        title: "Rights concern cleared",
        message: `Space Transfers reviewed your concern about order ${order.displayId} and cleared it: ${note}`.slice(0, 280),
        meta: { orderId: String(order._id), type: "rights_cleared" },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }
    publishOrderEvent(String(order._id), "order.updated", { orderId: String(order._id), updatedAt: new Date() });
    res.json({ concern: order.rightsConcern });
  } catch (error) {
    next(error);
  }
};
