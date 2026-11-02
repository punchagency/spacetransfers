import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import sharp from "sharp";
import { RightsDispute } from "../../models/rightsDispute.model.js";
import { RightsScreen } from "../../models/rightsScreen.model.js";
import { User } from "../../models/user.model.js";
import { checkImages } from "../../services/rights/screening.service.js";
import { storeArtwork, isStoredArtworkUrl } from "../../services/storage.service.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { CustomError } from "./shared.js";

/**
 * The customer's side of the rights check: checking a set of images, and
 * disputing a result with Space Transfers until an admin decides.
 */

const fail = (message: string, statusCode: number) => Object.assign(new Error(message) as CustomError, { statusCode });

const userId = (req: Request) => String(req.user?.id || "");

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Attachments are only ever files this server stored for a dispute. */
const attachments = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .filter((a: any) => a && typeof a.url === "string" && isStoredArtworkUrl(a.url))
    .slice(0, 5)
    .map((a: any) => ({ url: String(a.url), name: text(a.name, 120) || "Attachment" }));

/** The customer-facing shape: everything but the admin's internal notes. */
export const disputeView = (d: any) => ({
  id: String(d._id),
  imageUrl: d.imageUrl,
  imageName: d.imageName || null,
  status: d.status,
  findings: (d.findings || []).filter((f: any) => f.severity !== "info").map((f: any) => ({ id: f.id, label: f.label, severity: f.severity, detail: f.detail || null })),
  messages: (d.messages || []).map((m: any) => ({ author: m.author, authorName: m.author === "ADMIN" ? "Space Transfers" : m.authorName, body: m.body, attachments: m.attachments || [], at: m.at })),
  decision: d.decision ? { at: d.decision.at, note: d.decision.note, approvedFindings: d.decision.approvedFindings || [] } : null,
  awaitingAdmin: Boolean(d.awaitingAdmin),
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/** The verdict for each of a set of images: the editor shows them, and checkout asks before payment. */
export const checkRights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter((u: unknown): u is string => typeof u === "string").slice(0, 300) : [];
    // The editor asks with `screen: false` to show verdicts already reached, never to pay for a new check.
    res.json({ images: await checkImages(userId(req), urls, { screenMissing: req.body?.screen !== false }) });
  } catch (error) {
    next(error);
  }
};

export const listMyDisputes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await RightsDispute.find({ user: userId(req) }).sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ disputes: list.map(disputeView) });
  } catch (error) {
    next(error);
  }
};

const ownDispute = async (req: Request) => {
  const id = String(req.params.disputeId || "");
  if (!mongoose.isValidObjectId(id)) throw fail("Dispute not found", 404);
  const d = await RightsDispute.findOne({ _id: id, user: userId(req) });
  if (!d) throw fail("Dispute not found", 404);
  return d;
};

export const getMyDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ dispute: disputeView(await ownDispute(req)) });
  } catch (error) {
    next(error);
  }
};

const tellAdmins = async (req: Request, d: any, title: string, message: string) => {
  const me = await User.findById(userId(req)).select("email name").lean();
  notifyAllAdmins({
    category: "orders",
    priority: "medium",
    title,
    message: `${(me as any)?.email || "A customer"}: ${message}`.slice(0, 280),
    meta: { type: "rights_dispute", disputeId: String(d._id) },
  }).catch(() => {});
};

/**
 * Opens a dispute on an image the check stopped. One per image: a second
 * attempt adds to the open one rather than starting another conversation.
 */
export const openDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imageUrl = text(req.body?.imageUrl, 2000);
    const body = text(req.body?.message, 4000);
    if (!imageUrl) throw fail("Choose the image you're disputing.", 400);
    if (body.length < 10) throw fail("Tell us why you have the rights to print this image (at least a sentence).", 400);
    const [check] = await checkImages(userId(req), [imageUrl]);
    if (!check?.screenId) throw fail("That image couldn't be found. Please upload it again.", 404);
    if (check.verdict === "clear") throw fail("This image isn't held by the rights check, so there's nothing to dispute.", 400);
    const message = { author: "CUSTOMER" as const, authorName: "", body, attachments: attachments(req.body?.attachments), at: new Date() };

    const open = await RightsDispute.findOne({ user: userId(req), screen: check.screenId, status: "open" });
    if (open) {
      open.messages.push(message);
      open.awaitingAdmin = true;
      await open.save();
      await tellAdmins(req, open, "Rights dispute: new message", body);
      return res.json({ dispute: disputeView(open) });
    }
    const screen = await RightsScreen.findById(check.screenId).select("_id").lean();
    if (!screen) throw fail("That image couldn't be found. Please upload it again.", 404);
    const d = await RightsDispute.create({
      user: userId(req),
      screen: check.screenId,
      imageUrl,
      imageName: text(req.body?.imageName, 200) || undefined,
      findings: check.findings,
      messages: [message],
      awaitingAdmin: true,
    });
    await tellAdmins(req, d, "New rights dispute", body);
    res.status(201).json({ dispute: disputeView(d) });
  } catch (error) {
    next(error);
  }
};

export const replyToDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = await ownDispute(req);
    if (d.status !== "open") throw fail("This dispute has been decided. Open a new one if something has changed.", 409);
    const body = text(req.body?.message, 4000);
    if (!body) throw fail("Write a message first.", 400);
    d.messages.push({ author: "CUSTOMER", authorName: "", body, attachments: attachments(req.body?.attachments), at: new Date() });
    d.awaitingAdmin = true;
    await d.save();
    await tellAdmins(req, d, "Rights dispute: new message", body);
    res.json({ dispute: disputeView(d) });
  } catch (error) {
    next(error);
  }
};

export const withdrawDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = await ownDispute(req);
    if (d.status !== "open") throw fail("Only an open dispute can be withdrawn.", 409);
    d.status = "withdrawn";
    d.awaitingAdmin = false;
    await d.save();
    res.json({ dispute: disputeView(d) });
  } catch (error) {
    next(error);
  }
};

/** Stores one piece of evidence: a photo is re-saved without its location, a PDF kept as sent. */
export const uploadDisputeEvidence = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file?.buffer?.length) throw fail("Choose a file to attach.", 400);
    const folder = `rights-evidence/${userId(req)}`;
    if (file.mimetype === "application/pdf") {
      if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw fail("That file isn't a PDF we can read.", 400);
      const stored = await storeArtwork(file.buffer, folder, "application/pdf");
      return res.status(201).json({ url: stored.url, name: text(file.originalname, 120) || "licence.pdf" });
    }
    let photo: Buffer;
    try {
      photo = await sharp(file.buffer).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    } catch {
      throw fail("That image couldn't be read. Please try a different one.", 400);
    }
    const stored = await storeArtwork(photo, folder, "image/jpeg");
    res.status(201).json({ url: stored.url, name: text(file.originalname, 120) || "evidence.jpg" });
  } catch (error) {
    next(error);
  }
};
