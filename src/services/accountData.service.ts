import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import { Design } from "../models/design.model.js";
import { Asset } from "../models/asset.model.js";
import { OrderIssue } from "../models/orderIssue.model.js";
import { LoginActivity } from "../models/loginActivity.model.js";
import { Payout } from "../models/payout.model.js";
import { PrinterNotification } from "../models/printerNotification.model.js";
import { verifyPassword } from "../utils/passwords.js";
import { deleteStoredFiles } from "./storage.service.js";
import { ACTIVE_ORDER_STATUSES } from "./partnerCapacity.service.js";
import { getEligibleJobsForPrinter } from "./partnerEarnings.service.js";
import { changePartnerStatus } from "./partnerStatus.service.js";

/**
 * A customer's own data: a copy they can download, and closing the account.
 *
 * Orders are business records, so closing an account keeps them, with the
 * delivery details the order was shipped with, for as long as the retention
 * policy says. Everything else that belongs only to the account goes.
 */

const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** Orders still being made or shipped; an account with one can't close yet. */
export const OPEN_ORDER_STATUSES = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "SHIPPED"];

/** Everything held about a customer, in a form they can read and keep. */
export const buildAccountExport = async (userId: string) => {
  const user: any = await User.findById(userId).lean();
  if (!user) throw httpError("Account not found", 404);
  const id = new mongoose.Types.ObjectId(userId);
  const [orders, designs, assets, issues, logins, subAccounts] = await Promise.all([
    Order.find({ user: id }).sort({ createdAt: -1 }).lean(),
    Design.find({ user: id }).select("title size thumbnail createdAt updatedAt artboardData").lean(),
    Asset.find({ user: id }).select("originalFilename url mimeType sizeBytes widthPx heightPx createdAt").lean(),
    OrderIssue.find({ user: id }).sort({ createdAt: -1 }).lean(),
    LoginActivity.find({ userId: id }).sort({ createdAt: -1 }).limit(500).lean(),
    User.find({ parentAccount: id }).select("name email createdAt").lean(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    about: "Everything Space Transfers holds about your account. Your artwork files are linked by address.",
    account: {
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      companyName: user.companyName || null,
      signInWithGoogle: Boolean(user.googleId),
      avatarUrl: user.avatarUrl || null,
      createdAt: user.createdAt,
      isSubAccount: Boolean(user.isSubAccount),
      defaultShippingAddress: user.defaultShippingAddress || null,
      legalAcceptance: user.legalAcceptance || null,
      passkeys: (user.passkeys || []).map((p: any) => ({ name: p.name, addedAt: p.createdAt, lastUsedAt: p.lastUsedAt || null })),
    },
    subAccounts: subAccounts.map((s: any) => ({ name: s.name, email: s.email, createdAt: s.createdAt })),
    cart: user.cart || [],
    orders: orders.map((o: any) => ({
      number: o.displayId,
      placedAt: o.createdAt,
      status: o.status,
      shippingMethod: o.shippingMethod,
      customer: o.customer,
      shippingAddress: o.shippingAddress,
      items: (o.items || []).map((it: any) => ({
        name: it.name,
        quantity: it.quantity,
        widthIn: it.widthIn,
        heightIn: it.heightIn,
        previewImage: it.previewImage || null,
        artwork: (it.artboardItems || []).map((a: any) => a.url).filter(Boolean),
      })),
      pricing: o.pricing,
      payment: { method: o.payment?.method, cardBrand: o.payment?.cardBrand || null, cardLast4: o.payment?.cardLast4 || null },
      refunds: (o.payment?.refunds || []).map((r: any) => ({ amount: r.amount, reason: r.reason, at: r.at })),
      trackingNumber: o.trackingNumber || null,
      carrier: o.carrier || null,
      history: (o.statusTimeline || []).map((t: any) => ({ status: t.status, at: t.time, message: t.message })),
    })),
    savedSheets: designs.map((d: any) => ({
      title: d.title,
      size: d.size,
      thumbnail: d.thumbnail || null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      artwork: ((d.artboardData?.items || []) as any[]).map((i) => i.url).filter(Boolean),
    })),
    uploads: assets.map((a: any) => ({
      fileName: a.originalFilename,
      url: a.url,
      type: a.mimeType,
      bytes: a.sizeBytes,
      widthPx: a.widthPx,
      heightPx: a.heightPx,
      uploadedAt: a.createdAt,
    })),
    reportedProblems: issues.map((i: any) => ({
      order: i.displayId,
      type: i.type,
      description: i.description,
      photos: (i.attachments || []).map((a: any) => a.url),
      status: i.status,
      reportedAt: i.createdAt,
      messages: (i.messages || [])
        .filter((m: any) => m.channel === "CUSTOMER")
        .map((m: any) => ({ from: m.author === "CUSTOMER" ? "you" : "Space Transfers", text: m.body, photos: (m.attachments || []).map((a: any) => a.url), at: m.at })),
      resolution: i.resolution ? { outcome: i.resolution.outcome, note: i.resolution.note, at: i.resolution.at } : null,
    })),
    signIns: logins.map((l: any) => ({ at: l.createdAt, status: l.status, ip: l.ip, location: l.location, device: l.device })),
  };
};

/** The password again, or for an account without one, its email address typed out. */
const confirmIdentity = async (user: any, confirm: { password?: unknown; email?: unknown }) => {
  if (user.passwordHash) {
    if (typeof confirm.password !== "string" || !confirm.password) {
      throw httpError("Enter your current password to close your account.", 403);
    }
    if (!(await verifyPassword(confirm.password, user.passwordHash))) {
      throw httpError("That isn't your current password. Your account is still open.", 403);
    }
  } else if (String(confirm.email || "").trim().toLowerCase() !== String(user.email).toLowerCase()) {
    throw httpError("Type your email address exactly to confirm.", 403);
  }
};

/** Why this account can't be closed now, or null when it can. */
export const accountDeletionBlocker = (input: {
  role: string;
  isSubAccount?: boolean;
  subAccounts: number;
  openOrders: number;
  openReports?: number;
}): string | null => {
  if (input.role !== "CUSTOMER") return "Only customer accounts can be closed here. Contact Space Transfers to close a partner or admin account.";
  if (input.isSubAccount) return "This is a linked account. The main account holder can remove it from their Account Settings.";
  if (input.subAccounts > 0) return "Remove your linked accounts first, from Account Settings.";
  if (input.openOrders > 0) {
    return `You have ${input.openOrders} order${input.openOrders === 1 ? "" : "s"} still being made or delivered. You can close your account once ${input.openOrders === 1 ? "it arrives" : "they arrive"}.`;
  }
  if (input.openReports) {
    return `You have ${input.openReports === 1 ? "a problem report" : `${input.openReports} problem reports`} still open. You can close your account once we've resolved ${input.openReports === 1 ? "it" : "them"}.`;
  }
  return null;
};

/**
 * Closes a customer account. The password is asked for again; an account that
 * signs in with Google confirms by typing its email address instead.
 */
export const deleteCustomerAccount = async (userId: string, confirm: { password?: unknown; email?: unknown }) => {
  const user: any = await User.findById(userId);
  if (!user) throw httpError("Account not found", 404);
  const id = user._id;
  const [subAccounts, openOrders, openReports] = await Promise.all([
    User.countDocuments({ parentAccount: id }),
    Order.countDocuments({ user: id, status: { $in: OPEN_ORDER_STATUSES } }),
    OrderIssue.countDocuments({ user: id, status: "OPEN" }),
  ]);
  const blocker = accountDeletionBlocker({ role: user.role, isSubAccount: Boolean(user.isSubAccount), subAccounts, openOrders, openReports });
  if (blocker) throw httpError(blocker, 409);

  await confirmIdentity(user, confirm);

  // Uploaded files go, unless an order still prints from them.
  const assets = await Asset.find({ user: id }).select("url trimmedUrl").lean();
  const orders = await Order.find({ user: id }).select("items.previewImage items.artboardItems.url items.artboardItems.croppedUrl items.artboardItems.uncroppedUrl").lean();
  const usedByOrders = new Set<string>();
  for (const o of orders as any[]) {
    for (const it of o.items || []) {
      if (it.previewImage) usedByOrders.add(String(it.previewImage));
      for (const a of it.artboardItems || []) for (const u of [a.url, a.croppedUrl, a.uncroppedUrl]) if (u) usedByOrders.add(String(u));
    }
  }
  const files = (assets as any[]).flatMap((a) => [a.url, a.trimmedUrl]).filter((u) => u && !usedByOrders.has(String(u)));
  const filesRemoved = await deleteStoredFiles(files).catch((err: any) => {
    console.warn(`[ACCOUNT_DELETE] user ${userId}: files could not all be removed: ${err?.message}`);
    return 0;
  });

  await Promise.all([
    Design.deleteMany({ user: id }),
    Asset.deleteMany({ user: id }),
    LoginActivity.deleteMany({ userId: id }),
    // Orders and their reports stay as business records, marked as belonging to a closed account.
    Order.updateMany({ user: id }, { $set: { accountDeletedAt: new Date() } }, { strict: false }),
  ]);
  await User.deleteOne({ _id: id });
  return { ordersKept: orders.length, filesRemoved };
};

/** Payouts that are on their way to the partner and not yet settled. */
const UNSETTLED_PAYOUT_STATUSES = ["pending_review", "approved", "processing", "failed"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => `$${n.toFixed(2)}`;

/** Why a partner can't close their account now, or null when they can. */
export const partnerClosureBlocker = (input: { activeJobs: number; openIssues: number; owed: number }): string | null => {
  if (input.activeJobs > 0) {
    return `You have ${plural(input.activeJobs, "job", "jobs")} in progress. Ship ${input.activeJobs === 1 ? "it" : "them"}, or ask Space Transfers to reassign ${input.activeJobs === 1 ? "it" : "them"}, before closing your account.`;
  }
  if (input.openIssues > 0) {
    return `${plural(input.openIssues, "customer report on your jobs is", "customer reports on your jobs are")} still open. You can close your account once Space Transfers has resolved ${input.openIssues === 1 ? "it" : "them"}.`;
  }
  if (input.owed > 0) {
    return `You're still owed ${money(input.owed)}. You can close your account once it has been paid out.`;
  }
  return null;
};

/** What stands between a partner and closing their account, for the settings screen and the close itself. */
export const partnerClosureCheck = async (userId: string) => {
  const id = new mongoose.Types.ObjectId(userId);
  const [activeJobs, openIssues, eligible, unsettled] = await Promise.all([
    Order.countDocuments({ assignedPrinter: id, status: { $in: [...ACTIVE_ORDER_STATUSES] } }),
    OrderIssue.countDocuments({ partner: id, status: "OPEN" }),
    getEligibleJobsForPrinter(userId),
    Payout.find({ printerId: id, status: { $in: UNSETTLED_PAYOUT_STATUSES } }).select("amount").lean(),
  ]);
  const owed = Math.round((eligible.total + unsettled.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)) * 100) / 100;
  return { activeJobs, openIssues, owed, blocker: partnerClosureBlocker({ activeJobs, openIssues, owed }) };
};

/**
 * Closes a partner's account. Unlike a customer's, the record stays: jobs and
 * payouts point at it, and payout records are kept for accounting and tax. So
 * the business name, email, address and payout history remain, and everything
 * used to sign in or reach the partner goes. They can re-apply with the same email.
 */
export const closePartnerAccount = async (userId: string, confirm: { password?: unknown; email?: unknown }) => {
  const user: any = await User.findById(userId);
  if (!user || user.role !== "PRINTER") throw httpError("Account not found", 404);
  if (user.status === "Closed") throw httpError("This account is already closed.", 409);

  const { blocker } = await partnerClosureCheck(userId);
  if (blocker) throw httpError(blocker, 409);
  await confirmIdentity(user, confirm);

  const result = await changePartnerStatus({
    partnerId: userId,
    to: "Closed",
    reason: "Closed by the partner",
    actor: { id: userId, name: user.companyName || user.name },
    expectedFrom: user.status,
  });
  if (!result) throw httpError("Your account changed while closing it. Please try again.", 409);

  const files = [user.avatarUrl, ...(user.certifications || []).map((c: any) => c.documentUrl)].filter(Boolean);
  await deleteStoredFiles(files).catch((err: any) => {
    console.warn(`[ACCOUNT_CLOSE] partner ${userId}: files could not all be removed: ${err?.message}`);
  });
  await Promise.all([
    User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: null,
          googleId: null,
          avatarUrl: null,
          certifications: [],
          resetPasswordTokenHash: null,
          resetPasswordExpiresAt: null,
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
          availabilityStatus: "paused",
          capacityPaused: false,
          payoutsEnabled: false,
          "settings.notifications.email": { newJobs: false, orderUpdates: false, payoutAlerts: false, accountUpdates: false, systemAlerts: false },
        },
        $unset: { phone: 1, website: 1, businessDetails: 1, passkeys: 1, recoveryCodes: 1 },
        $inc: { tokenVersion: 1 },
      },
    ),
    LoginActivity.deleteMany({ userId: user._id }),
    PrinterNotification.deleteMany({ printerId: user._id }),
  ]);
  return { closed: true, notified: result.notified };
};
