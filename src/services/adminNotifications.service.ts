import mongoose from "mongoose";
import { User, UserRoles } from "../models/user.model.js";
import { AdminNotification, type AdminNotificationCategory, type AdminNotificationPriority } from "../models/adminNotification.model.js";
import { AdminNotificationEmailBatch } from "../models/adminNotificationEmailBatch.model.js";
import { sendEmail } from "./email.service.js";
import { publishAdminNotificationEvent } from "./adminNotificationsHub.js";

export type AdminPreferenceKey = "orderUpdates" | "partnerActivity" | "systemAlerts";

const categoryToPrefKey: Record<AdminNotificationCategory, AdminPreferenceKey> = {
  orders: "orderUpdates",
  partners: "partnerActivity",
  system: "systemAlerts"
};

/**
 * System alerts stay ON.
 *
 * They were briefly defaulted off because the category was unusable: it was
 * dominated by "Sign-in detected", which fired on every login and was broadcast
 * to every admin. That was fixed at the source — the alert now fires only for a
 * sign-in from an unrecognised device, and only to the account it concerns.
 *
 * With the noise gone the category is worth receiving: what remains is "Sign-in
 * from a new device", "Failed sign-in attempt", "Password changed" and "Email
 * verified", all security notices about the admin's own account. Defaulting
 * those off would have silenced the warnings along with the noise.
 */
export const getDefaultAdminNotificationPrefs = (): Record<AdminPreferenceKey, boolean> => ({
  orderUpdates: true,
  partnerActivity: true,
  systemAlerts: true
});

export const isAdminCategoryEnabled = (prefs: any, category: AdminNotificationCategory) => {
  const key = categoryToPrefKey[category];
  const v = prefs && typeof prefs === "object" ? prefs[key] : undefined;
  if (typeof v === "boolean") return v;
  return getDefaultAdminNotificationPrefs()[key];
};

export const createAdminNotification = async ({
  adminId,
  category,
  priority,
  title,
  message,
  meta
}: {
  adminId: string;
  category: AdminNotificationCategory;
  priority: AdminNotificationPriority;
  title: string;
  message: string;
  meta?: any;
}) => {
  const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN }).select("settings.notifications email name").lean();
  if (!admin) return null;

  const prefs = (admin as any)?.settings?.notifications?.email || null;
  if (!isAdminCategoryEnabled(prefs, category)) return null;

  const notification = await AdminNotification.create({
    adminId: new mongoose.Types.ObjectId(adminId),
    category,
    priority,
    title,
    message,
    meta: meta ?? null,
    readAt: null,
    email: { status: "queued" }
  });

  publishAdminNotificationEvent(adminId, "notification.created", {
    id: notification._id,
    category,
    priority,
    title,
    message,
    // Included so a notification arriving live is as linkable as one loaded
    // from the list endpoint — otherwise it stays a dead end until a refresh.
    meta: meta ?? null,
    readAt: null,
    createdAt: notification.createdAt
  });

  await enqueueAdminNotificationEmailBatch(adminId, String(notification._id));
  return notification;
};

export const notifyAllAdmins = async ({
  category,
  priority,
  title,
  message,
  meta
}: {
  category: AdminNotificationCategory;
  priority: AdminNotificationPriority;
  title: string;
  message: string;
  meta?: any;
}) => {
  const admins = await User.find({ role: UserRoles.ADMIN, status: "Active" })
    .select("_id")
    .lean();

  await Promise.all(
    admins.map((a: any) =>
      createAdminNotification({
        adminId: String(a._id),
        category,
        priority,
        title,
        message,
        meta
      })
    )
  );
};

const BATCH_WINDOW_MS = 60_000;

export const enqueueAdminNotificationEmailBatch = async (adminId: string, notificationId: string) => {
  const now = new Date();
  const dueAt = new Date(now.getTime() + BATCH_WINDOW_MS);

  const batch = await AdminNotificationEmailBatch.findOneAndUpdate(
    { adminId: new mongoose.Types.ObjectId(adminId), status: "pending" },
    {
      $setOnInsert: { dueAt },
      $addToSet: { notificationIds: new mongoose.Types.ObjectId(notificationId) }
    },
    { upsert: true, new: true }
  );

  await AdminNotification.updateOne(
    { _id: new mongoose.Types.ObjectId(notificationId) },
    { $set: { "email.batchId": batch._id } }
  );
};

/** Titles and messages carry what customers and partners typed; in an email it must stay text. */
const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const buildBatchedAdminEmailHtml = ({
  adminName,
  items
}: {
  adminName: string;
  items: { category: string; priority: string; title: string; message: string; createdAt: Date }[];
}) => {
  const safeName = String(adminName || "").trim() || "Admin";
  const rows = items
    .map((n) => {
      const time = new Date(n.createdAt).toLocaleString();
      const badgeBg =
        n.priority === "high" ? "#fee2e2" : n.priority === "medium" ? "#fef9c3" : "#e5e7eb";
      const badgeText =
        n.priority === "high" ? "#991b1b" : n.priority === "medium" ? "#854d0e" : "#374151";
      const cat = String(n.category || "").toUpperCase();
      return `
        <tr>
          <td style="padding: 10px 0; border-top: 1px solid #e5e7eb;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="display:inline-block; padding: 2px 8px; border-radius: 999px; background:${badgeBg}; color:${badgeText}; font-size: 12px; font-weight: 700;">
                ${String(n.priority).toUpperCase()}
              </span>
              <span style="display:inline-block; padding: 2px 8px; border-radius: 999px; background:#eff6ff; color:#1d4ed8; font-size: 12px; font-weight: 700;">
                ${cat}
              </span>
              <span style="color:#6b7280; font-size:12px;">${time}</span>
            </div>
            <div style="margin-top: 6px; font-weight:700; color:#111827;">${escapeHtml(n.title)}</div>
            <div style="margin-top: 2px; color:#374151;">${escapeHtml(n.message)}</div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px 0;">Hi ${safeName},</h2>
      <p style="margin: 0 0 16px 0;">Here are your latest admin notifications:</p>
      <table style="width:100%; border-collapse: collapse;">
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p style="margin: 16px 0 0 0; font-size: 12px; color: #6b7280;">
        You can manage which notifications you receive in Preferences.
      </p>
    </div>
  `;
};

/*
 * A batch that failed (Resend briefly down, say) is tried again, and one left
 * "sending" by a process that stopped mid-send is picked up again; before, both
 * were dropped and the admin never got that email.
 */
const EMAIL_MAX_ATTEMPTS = 3;
const EMAIL_RETRY_AFTER_MS = 5 * 60 * 1000;
const EMAIL_STALE_SENDING_MS = 10 * 60 * 1000;
// Only today's news: an email retried days later would only confuse.
const EMAIL_RETRY_WITHIN_MS = 24 * 60 * 60 * 1000;

export const dueEmailBatchesFilter = (now: Date) => {
  const recent = { $gte: new Date(now.getTime() - EMAIL_RETRY_WITHIN_MS) };
  return {
    $or: [
      { status: "pending", dueAt: { $lte: now } },
      { status: "failed", dueAt: recent, attempts: { $lt: EMAIL_MAX_ATTEMPTS }, lastAttemptAt: { $lte: new Date(now.getTime() - EMAIL_RETRY_AFTER_MS) } },
      { status: "sending", dueAt: recent, lastAttemptAt: { $lte: new Date(now.getTime() - EMAIL_STALE_SENDING_MS) } },
    ],
  };
};

export const processDueAdminNotificationEmailBatches = async () => {
  const now = new Date();
  const batches = await AdminNotificationEmailBatch.find(dueEmailBatchesFilter(now))
    .sort({ dueAt: 1, _id: 1 })
    .limit(25)
    .lean();

  for (const b of batches as any[]) {
    const batchId = String(b._id);
    const adminId = String(b.adminId);

    // Taken only as found, so a batch is never sent by two passes at once.
    const locked = await AdminNotificationEmailBatch.updateOne(
      { _id: b._id, status: b.status, lastAttemptAt: b.lastAttemptAt ?? null },
      { $set: { status: "sending", lastAttemptAt: new Date() }, $inc: { attempts: 1 } }
    );
    if (!locked.acknowledged || locked.modifiedCount !== 1) continue;

    const admin = await User.findById(b.adminId).select("email name settings.notifications").lean();
    if (!admin) {
      await AdminNotificationEmailBatch.updateOne(
        { _id: b._id },
        { $set: { status: "failed", error: "admin_not_found" } }
      );
      continue;
    }

    const notifications = await AdminNotification.find({
      _id: { $in: b.notificationIds || [] }
    })
      .select("category priority title message createdAt email.status")
      .lean();

    // "failed" too: on a retry, the notifications are still marked from the last attempt.
    const eligible = notifications.filter((n: any) => n?.email?.status === "queued" || n?.email?.status === "failed");
    if (eligible.length === 0) {
      await AdminNotificationEmailBatch.updateOne(
        { _id: b._id },
        { $set: { status: "sent", sentAt: new Date() } }
      );
      continue;
    }

    const prefs = (admin as any)?.settings?.notifications?.email || null;
    const filtered = eligible.filter((n: any) =>
      isAdminCategoryEnabled(prefs, n.category as AdminNotificationCategory)
    );

    if (filtered.length === 0) {
      await AdminNotification.updateMany(
        { _id: { $in: eligible.map((n: any) => n._id) } },
        { $set: { "email.status": "skipped" } }
      );
      await AdminNotificationEmailBatch.updateOne(
        { _id: b._id },
        { $set: { status: "sent", sentAt: new Date() } }
      );
      continue;
    }

    const html = buildBatchedAdminEmailHtml({
      adminName: String((admin as any).name || "Admin"),
      items: filtered.map((n: any) => ({
        category: n.category,
        priority: n.priority,
        title: n.title,
        message: n.message,
        createdAt: n.createdAt
      }))
    });

    const subject =
      filtered.length === 1
        ? `Admin notification: ${filtered[0].title}`
        : `Admin notifications (${filtered.length})`;

    const result = await sendEmail({ to: String((admin as any).email), subject, html });

    if (result.sent) {
      await AdminNotification.updateMany(
        { _id: { $in: filtered.map((n: any) => n._id) } },
        {
          $set: {
            "email.status": "sent",
            "email.sentAt": new Date(),
            "email.attemptedAt": new Date(),
            "email.error": null,
            "email.messageId": result.messageId
          }
        }
      );
      await AdminNotificationEmailBatch.updateOne(
        { _id: b._id },
        { $set: { status: "sent", sentAt: new Date(), messageId: result.messageId || null, error: null } }
      );
      continue;
    }

    await AdminNotification.updateMany(
      { _id: { $in: filtered.map((n: any) => n._id) } },
      {
        $set: {
          "email.status": "failed",
          "email.attemptedAt": new Date(),
          "email.error": result.error || "email_failed",
          "email.messageId": null
        }
      }
    );
    await AdminNotificationEmailBatch.updateOne(
      { _id: b._id },
      { $set: { status: "failed", error: result.error || "email_failed" } }
    );

    publishAdminNotificationEvent(adminId, "notification.email_failed", {
      batchId,
      error: result.error || "email_failed"
    });
  }
};

