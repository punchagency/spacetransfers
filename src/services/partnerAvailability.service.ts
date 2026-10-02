import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { broadcastToAllAdmins } from "./adminNotificationsHub.js";
import { publishPrinterNotificationEvent } from "./printerNotificationsHub.js";
import {
  countActiveJobs,
  getAssignmentSettings,
  getEffectiveMaxConcurrent,
  isAtCapacity,
} from "./partnerCapacity.service.js";

export type AvailabilityStatus = "open" | "paused";

export interface AvailabilityActor {
  id?: string | null;
  name?: string | null;
  /** Who initiated it — decides who gets told, and what the message says. */
  kind: "partner" | "admin" | "system";
}

export interface AvailabilityChangeResult {
  availabilityStatus: AvailabilityStatus;
  /** At or over the job limit right now — they cannot switch themselves to Open. */
  capacityLocked: boolean;
  /**
   * Always false after a manual change: a pause a person chose is never
   * auto-reopened, so the flag that drives auto-recovery is cleared. Reported
   * so the consoles can say who paused them without a second read.
   */
  capacityPaused: boolean;
  activeJobs: number;
  maxJobs: number | null;
  /**
   * Whether the partner's in-app notification was created. Only meaningful when
   * an admin made the change.
   *
   * This is the in-app channel only. `notifyPrinter` sends its email
   * fire-and-forget and does not report the outcome — same as every other
   * printer notification — so claiming to know whether mail arrived would be
   * inventing a fact. The in-app notification is the channel that is actually
   * reliable today, and it is the one reported here.
   */
  partnerNotified: boolean;
  partnerNotifyError?: string | null;
}

/**
 * Applies an availability change and tells everyone who needs to know.
 *
 * Returns null when the partner does not exist. Throws a 409-shaped error when
 * a partner tries to reopen while at capacity — recovery from that is automatic
 * and letting them force it would hand them work they cannot take.
 */
export const changePartnerAvailability = async ({
  partnerId,
  to,
  actor,
  reason,
}: {
  partnerId: string;
  to: AvailabilityStatus;
  actor: AvailabilityActor;
  reason?: string | null;
}): Promise<AvailabilityChangeResult | null> => {
  const partner = await User.findOne({ _id: partnerId, role: "PRINTER" }).select(
    "availabilityStatus capacityPaused settings.jobCapacity companyName name email",
  );
  if (!partner) return null;

  const from = ((partner as any).availabilityStatus ?? "open") as AvailabilityStatus;
  const partnerName = String((partner as any).companyName || partner.name || "there");

  const activeJobs = await countActiveJobs(partnerId);
  // Same resolution the capacity monitor and the assignment ranker use: the
  // stricter of the global limit and any per-partner override.
  const assignmentSettings = await getAssignmentSettings();
  const maxJobs = getEffectiveMaxConcurrent(partner as any, assignmentSettings);
  const atCapacity = isAtCapacity(activeJobs, maxJobs);

  /*
   * A partner may not reopen while at capacity — the system paused them and
   * will reopen them automatically. An admin may, because an admin overriding
   * a capacity pause is a deliberate act by someone who can see the whole
   * picture, not an accident.
   */
  if (to === "open" && atCapacity && actor.kind === "partner") {
    const error = new Error(
      `You're at your maximum of ${maxJobs} active ${maxJobs === 1 ? "job" : "jobs"}. ` +
        `You'll be set back to Open automatically once your active job count drops below ${maxJobs}.`,
    ) as any;
    error.statusCode = 409;
    error.code = "AT_MAX_CAPACITY";
    throw error;
  }

  /*
   * A manual change is an explicit override, so the capacity flag is cleared —
   * the system must not later auto-reopen someone who paused themselves. An
   * admin reopening a capacity-paused partner clears it for the same reason.
   */
  await User.updateOne(
    { _id: new mongoose.Types.ObjectId(String(partnerId)) },
    { $set: { availabilityStatus: to, capacityPaused: false } },
  );

  // One meaning, matching the capacity monitor: at the limit right now. A
  // partner an admin force-opened at capacity is still locked out of pausing
  // and reopening on their own, and the badge shows that honestly.
  const capacityLocked = atCapacity;
  const changed = from !== to;

  /*
   * Pushed to the partner's own sessions regardless of who changed it. The
   * badge already listens for this — it was only ever published by the capacity
   * monitor, so a change made in another tab, or by an admin, left every other
   * session showing a stale pill until refresh.
   */
  publishPrinterNotificationEvent(String(partnerId), "availability.changed", {
    availabilityStatus: to,
    capacityLocked,
    capacityPaused: false,
    activeJobs,
    maxJobs,
    reason: actor.kind === "admin" ? "admin_changed" : undefined,
    changedBy: actor.kind === "admin" ? actor.name || "An administrator" : undefined,
  });

  // And to every admin console, which now renders it.
  broadcastToAllAdmins("partner.availability_changed", {
    partnerId: String(partnerId),
    availabilityStatus: to,
    capacityLocked,
    capacityPaused: false,
    activeJobs,
    maxJobs,
  });

  let partnerNotified = false;
  let partnerNotifyError: string | null = null;

  if (changed && actor.kind === "admin") {
    /*
     * Only when an admin did it. A partner who just pressed the button does not
     * need to be told what they pressed, and mailing them their own click would
     * teach them to ignore these.
     */
    const who = actor.name ? `${actor.name}` : "An administrator";
    const created = await notifyPrinter({
      printerId: String(partnerId),
      category: "system",
      priority: to === "paused" ? "high" : "medium",
      title: to === "paused" ? "Your availability was set to Paused" : "Your availability was set to Open",
      message:
        to === "paused"
          ? `${who} paused your availability, so you will not receive new auto-assigned jobs until it is set back to Open.${reason ? ` Reason: ${reason}` : ""} Jobs already assigned to you are unaffected.`
          : `${who} set your availability back to Open. You will start receiving auto-assigned jobs again.${reason ? ` Reason: ${reason}` : ""}`,
      meta: { availabilityStatus: to, changedBy: who },
      settingsKey: "accountUpdates",
    }).catch(() => null);

    // Null means the partner was not found, or they have this category muted.
    partnerNotified = Boolean(created);
    partnerNotifyError = created ? null : "the partner has account updates muted, or could not be notified";
  }

  if (changed && actor.kind === "partner") {
    /*
     * Admins are told in-app when a partner takes themselves out of rotation,
     * because it changes who work can be routed to. `notifyAllAdmins` respects
     * each admin's own notification preferences.
     */
    notifyAllAdmins({
      category: "partners",
      priority: to === "paused" ? "medium" : "low",
      title: to === "paused" ? "Partner paused themselves" : "Partner is available again",
      message:
        to === "paused"
          ? `${partnerName} paused their availability and will not receive new auto-assigned jobs.`
          : `${partnerName} set themselves back to Open and is accepting jobs again.`,
      meta: { partnerId: String(partnerId), availabilityStatus: to },
    }).catch(() => {});
  }

  return {
    availabilityStatus: to,
    capacityLocked,
    capacityPaused: false,
    activeJobs,
    maxJobs,
    partnerNotified,
    partnerNotifyError,
  };
};
