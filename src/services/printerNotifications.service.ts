import mongoose from "mongoose";
import { User, UserRoles } from "../models/user.model.js";
import { PrinterNotification, type PrinterNotificationCategory, type PrinterNotificationPriority } from "../models/printerNotification.model.js";
import { publishPrinterNotificationEvent } from "./printerNotificationsHub.js";
import { sendEmail } from "./email.service.js";

/*
 * "systemAlerts" removed: no notification anywhere is sent with it, so it
 * gated nothing. The system-category messages a partner actually receives
 * (email verified, availability changed by an admin) ride on accountUpdates.
 */
export type EmailSettingsKey = "newJobs" | "orderUpdates" | "payoutAlerts" | "accountUpdates";

function buildNotificationEmailHtml(title: string, message: string): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 520px; margin: 0 auto;">
      <div style="background: #1d4ed8; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <span style="color: #ffffff; font-size: 16px; font-weight: 700;">Space Transfers</span>
      </div>
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #111827;">${title}</h2>
        <p style="margin: 0 0 20px 0; font-size: 14px; color: #374151;">${message}</p>
        <p style="margin: 0; font-size: 12px; color: #9ca3af;">
          You received this email because you have this notification type enabled in your Space Transfers printer settings.
          To stop these emails, update your notification preferences in Settings.
        </p>
      </div>
    </div>
  `.trim();
}

export const createPrinterNotification = async ({
  printerId,
  category,
  priority,
  title,
  message,
  meta,
  settingsKey,
}: {
  printerId: string;
  category: PrinterNotificationCategory;
  priority: PrinterNotificationPriority;
  title: string;
  message: string;
  meta?: any;
  settingsKey?: EmailSettingsKey;
}) => {
  const printer = await User.findOne({ _id: printerId, role: UserRoles.PRINTER })
    .select("_id email settings")
    .lean();
  if (!printer) return null;

  // If a settingsKey is provided and the printer has explicitly disabled it, skip entirely.
  if (settingsKey) {
    const emailPrefs = (printer as any).settings?.notifications?.email;
    if (emailPrefs && emailPrefs[settingsKey] === false) {
      return null;
    }
  }

  const notification = await PrinterNotification.create({
    printerId: new mongoose.Types.ObjectId(printerId),
    category,
    priority,
    title,
    message,
    meta: meta ?? null,
    readAt: null,
  });

  publishPrinterNotificationEvent(printerId, "notification.created", {
    id: notification._id,
    category,
    priority,
    title,
    message,
    readAt: null,
    createdAt: notification.createdAt,
  });

  // Send email in sync with the in-app notification (fire-and-forget).
  if (settingsKey) {
    const printerEmail = (printer as any).email;
    if (printerEmail) {
      sendEmail({
        to: String(printerEmail),
        subject: `Space Transfers: ${title}`,
        html: buildNotificationEmailHtml(title, message),
      }).catch(() => {});
    }
  }

  return notification;
};

export const notifyPrinter = async ({
  printerId,
  category,
  priority,
  title,
  message,
  meta,
  settingsKey,
}: {
  printerId: string;
  category: PrinterNotificationCategory;
  priority: PrinterNotificationPriority;
  title: string;
  message: string;
  meta?: any;
  settingsKey?: EmailSettingsKey;
}) => createPrinterNotification({ printerId, category, priority, title, message, meta, settingsKey });
