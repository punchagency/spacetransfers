import { User } from "../models/user.model.js";
import { sendEmail } from "./email.service.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { env } from "../config/env.js";

/**
 * The one route by which a partner's status changes.
 *
 * Approval, rejection, suspension and reinstatement were each implemented on
 * their own: approve logged a fake activation email, reject sent and logged
 * nothing at all, and a suspension applied through the status endpoint told the
 * partner nothing and recorded no reason. So the two most consequential things
 * that can happen to a partner — being turned down and being cut off — were the
 * two that happened silently.
 *
 * Everything now goes through `changePartnerStatus`, which records the change
 * with its reason and author, tells the partner, and notifies the admins. A new
 * status cannot be introduced without deciding what it says to the person it
 * affects, because there is nowhere else to put the transition.
 */

export type PartnerStatus = "Active" | "Pending" | "Suspended" | "Under Review" | "Rejected";

interface Actor {
  id?: string | null;
  name?: string | null;
}

interface StatusMessage {
  subject: string;
  body: (partnerName: string, reason?: string | null) => string;
  /** Some transitions are internal and warrant no message to the partner. */
  notifyPartner: boolean;
  adminTitle: string;
}

const signInUrl = `${env.printerAppUrl.replace(/\/$/, "")}/auth`;

const reasonBlock = (reason?: string | null) =>
  reason && reason.trim()
    ? `<p style="margin:0 0 12px 0;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">${reason.trim()}</p>`
    : "";

/**
 * What each outcome says. Written out per status rather than assembled from a
 * template, because "your application was declined" and "your account has been
 * suspended" are different messages to different people at different moments,
 * and a shared template is how they end up sounding the same.
 */
const MESSAGES: Record<PartnerStatus, StatusMessage> = {
  Active: {
    subject: "Your Space Transfers partner account is active",
    notifyPartner: true,
    adminTitle: "Printer approved",
    body: (name, reason) => `
      <p style="margin:0 0 12px 0;">Hello ${name},</p>
      <p style="margin:0 0 12px 0;">Your print partner account is approved and active. You can sign in and start receiving jobs.</p>
      ${reasonBlock(reason)}
      <p style="margin:0 0 16px 0;">
        <a href="${signInUrl}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;">Sign in</a>
      </p>
      <p style="margin:0;font-size:12px;color:#6b7280;">Please make sure your business address, service areas and printing capabilities are complete — we route work using them.</p>
    `,
  },
  Rejected: {
    subject: "About your Space Transfers partner application",
    notifyPartner: true,
    adminTitle: "Printer rejected",
    body: (name, reason) => `
      <p style="margin:0 0 12px 0;">Hello ${name},</p>
      <p style="margin:0 0 12px 0;">Thank you for applying to join the Space Transfers print network. On this occasion your application was not approved.</p>
      ${reason && reason.trim() ? `<p style="margin:0 0 6px 0;font-weight:600;">Reason</p>${reasonBlock(reason)}` : ""}
      <p style="margin:0;font-size:12px;color:#6b7280;">If you believe this was a mistake, or your circumstances change, reply to this email and we will take another look.</p>
    `,
  },
  Suspended: {
    subject: "Your Space Transfers partner account has been suspended",
    notifyPartner: true,
    adminTitle: "Printer suspended",
    body: (name, reason) => `
      <p style="margin:0 0 12px 0;">Hello ${name},</p>
      <p style="margin:0 0 12px 0;">Your print partner account has been suspended. You will not receive new jobs while this is in place, and you cannot sign in.</p>
      ${reason && reason.trim() ? `<p style="margin:0 0 6px 0;font-weight:600;">Reason</p>${reasonBlock(reason)}` : ""}
      <p style="margin:0;font-size:12px;color:#6b7280;">A suspension can be lifted. Reply to this email to discuss it with us.</p>
    `,
  },
  "Under Review": {
    subject: "Your Space Transfers partner account is under review",
    notifyPartner: true,
    adminTitle: "Printer placed under review",
    body: (name, reason) => `
      <p style="margin:0 0 12px 0;">Hello ${name},</p>
      <p style="margin:0 0 12px 0;">Your partner account is currently under review. You can still sign in, and we will be in touch shortly.</p>
      ${reasonBlock(reason)}
    `,
  },
  Pending: {
    // Reached when someone re-applies. The signup screen already tells them, and
    // an email repeating it adds nothing.
    subject: "",
    notifyPartner: false,
    adminTitle: "Printer application received",
    body: () => "",
  },
};

export interface StatusChangeResult {
  partner: any;
  notified: boolean;
  notifyError?: string | null;
}

/**
 * Applies a status change, records it, and tells everyone who needs to know.
 *
 * `expectedFrom` makes the write conditional: passing it means the change only
 * lands if the partner is still in that state, which is what stops a stale
 * approvals queue from suspending someone who was approved a minute earlier.
 */
export const changePartnerStatus = async ({
  partnerId,
  to,
  reason,
  actor,
  expectedFrom,
}: {
  partnerId: string;
  to: PartnerStatus;
  reason?: string | null;
  actor?: Actor;
  expectedFrom?: PartnerStatus | PartnerStatus[];
}): Promise<StatusChangeResult | null> => {
  const filter: any = { _id: partnerId, role: "PRINTER" };
  if (expectedFrom) {
    filter.status = Array.isArray(expectedFrom) ? { $in: expectedFrom } : expectedFrom;
  }

  const before = await User.findOne(filter);
  if (!before) return null;

  const from = String(before.status || "");
  const partnerName = String((before as any).companyName || before.name || "there");
  const message = MESSAGES[to];

  /*
   * The change is made durable first, then the partner is told.
   *
   * Sending first meant that if the save afterwards failed, someone had already
   * been emailed "your account has been suspended" about a suspension that
   * never happened. This ordering can only fail the other way — a change that
   * stuck but was not announced — which is recoverable and is recorded as
   * `notified: false` rather than being lost.
   */
  before.status = to as any;
  (before as any).statusHistory = [
    ...((before as any).statusHistory || []),
    {
      from,
      to,
      reason: reason?.trim() || null,
      at: new Date(),
      byId: actor?.id || null,
      byName: actor?.name || null,
      notified: false,
    },
  ];
  await before.save();

  let notified = false;
  let notifyError: string | null = null;
  if (message.notifyPartner) {
    const result = await sendEmail({
      to: before.email,
      subject: message.subject,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">${message.body(partnerName, reason)}</div>`,
    }).catch((e: any) => ({ sent: false, messageId: null, error: e?.message || "send failed" }));

    notified = result.sent === true;
    notifyError = result.sent ? null : result.error || "no email transport configured";

    if (notified) {
      // Recorded after the fact, since the send is what decides it. A failure
      // to write this flag under-reports delivery, which is the safe direction.
      const history = (before as any).statusHistory;
      history[history.length - 1].notified = true;
      await before.save().catch(() => {});
    } else {
      console.error(
        `[PARTNER_STATUS] ${before.email} moved ${from} -> ${to} but could not be told: ${notifyError}`,
      );
    }
  }

  notifyAllAdmins({
    category: "partners",
    priority: "medium",
    title: message.adminTitle,
    message:
      `${partnerName} • ${before.email}` +
      (reason?.trim() ? ` — ${reason.trim()}` : "") +
      (message.notifyPartner && !notified ? " (partner could NOT be emailed)" : ""),
    meta: { partnerId: String(before._id), from, to },
  }).catch(() => {});

  return { partner: before, notified, notifyError };
};
