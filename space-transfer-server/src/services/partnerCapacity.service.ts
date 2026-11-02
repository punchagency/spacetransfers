import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { User, UserRoles } from "../models/user.model.js";
import { Settings } from "../models/settings.model.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import { publishPrinterNotificationEvent } from "./printerNotificationsHub.js";
import { broadcastToAllAdmins } from "./adminNotificationsHub.js";

// Statuses that count against a partner's active job capacity. A job in any of
// these states is "occupying a slot"; once it moves to a terminal state
// (SHIPPED / COMPLETED / CANCELLED) the slot frees up.
//
// PAUSED dropped with the status itself — only the orphaned `executeJobAction`
// PAUSE case ever wrote it, and no UI reached that.
export const ACTIVE_ORDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PRINTING",
  "QUALITY_CHECK",
] as const;

export type AssignmentRule = "nearest-region" | "manual";

/**
 * Stage deadlines, in hours, per priority.
 *
 * Two stages because they fail differently. A job sitting unstarted can be
 * handed to someone else safely — nothing physical has happened. A job that has
 * been on the press too long must NOT be reassigned: the partner may have film
 * loaded, and moving it means printing twice and paying twice. That one is
 * raised for a human instead.
 */
export interface SlaStageHours {
  normal: number;
  urgent: number;
}

export interface SlaSettings {
  /**
   * Off by default, deliberately. This moves live jobs between businesses, so
   * it starts only when an operator turns it on knowingly.
   */
  enabled: boolean;
  /** PROCESSING -> PRINTING. Breach reassigns. */
  acceptHours: SlaStageHours;
  /** PRINTING -> QUALITY_CHECK. Breach escalates, never reassigns. */
  printHours: SlaStageHours;
  /** Stops a job bouncing between partners forever. */
  maxAutoReassignments: number;
}

export interface PartnerAssignmentSettings {
  rule: AssignmentRule;
  maxJobsEnabled: boolean;
  maxJobsValue: number | null;
  sla: SlaSettings;
}

export const DEFAULT_SLA_SETTINGS: SlaSettings = {
  enabled: false,
  acceptHours: { normal: 24, urgent: 4 },
  printHours: { normal: 48, urgent: 12 },
  maxAutoReassignments: 2,
};

const DEFAULT_SETTINGS: PartnerAssignmentSettings = {
  rule: "nearest-region",
  maxJobsEnabled: true,
  maxJobsValue: 10,
  sla: DEFAULT_SLA_SETTINGS,
};

const positiveHours = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const normalizeSlaSettings = (value: unknown): SlaSettings => {
  const v = (value as any) || {};
  return {
    enabled: v.enabled === true,
    acceptHours: {
      normal: positiveHours(v.acceptHours?.normal, DEFAULT_SLA_SETTINGS.acceptHours.normal),
      urgent: positiveHours(v.acceptHours?.urgent, DEFAULT_SLA_SETTINGS.acceptHours.urgent),
    },
    printHours: {
      normal: positiveHours(v.printHours?.normal, DEFAULT_SLA_SETTINGS.printHours.normal),
      urgent: positiveHours(v.printHours?.urgent, DEFAULT_SLA_SETTINGS.printHours.urgent),
    },
    // Zero is meaningful — it disables reassignment while leaving escalation on.
    maxAutoReassignments: (() => {
      const n = Number(v.maxAutoReassignments);
      return Number.isFinite(n) && n >= 0
        ? Math.floor(n)
        : DEFAULT_SLA_SETTINGS.maxAutoReassignments;
    })(),
  };
};

/**
 * Read the global partner-assignment settings (assignment mode + max jobs).
 * Falls back to sane defaults when the settings document does not exist yet.
 */
export const getAssignmentSettings = async (): Promise<PartnerAssignmentSettings> => {
  const doc = await Settings.findOne({ key: "partnerAssignment" }).lean();
  const value = (doc as any)?.value || {};
  const rule: AssignmentRule = value.rule === "manual" ? "manual" : "nearest-region";
  const maxJobsEnabled = value.maxJobsEnabled !== false;
  const rawMax = Number(value.maxJobsValue);
  const maxJobsValue =
    maxJobsEnabled && Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : maxJobsEnabled ? DEFAULT_SETTINGS.maxJobsValue : null;
  return { rule, maxJobsEnabled, maxJobsValue, sla: normalizeSlaSettings(value.sla) };
};

/**
 * Effective per-partner maximum concurrent jobs. Combines the global
 * "Maximum Jobs per Partner" limit with any per-partner override
 * (settings.jobCapacity.maxConcurrent), taking the most restrictive of the two.
 * Returns null when no limit applies.
 */
export const getEffectiveMaxConcurrent = (
  partner: { settings?: { jobCapacity?: { maxConcurrent?: number } } } | null | undefined,
  settings: PartnerAssignmentSettings
): number | null => {
  const limits: number[] = [];
  if (settings.maxJobsEnabled && settings.maxJobsValue && settings.maxJobsValue > 0) {
    limits.push(settings.maxJobsValue);
  }
  const perPartner = Number(partner?.settings?.jobCapacity?.maxConcurrent ?? 0);
  if (Number.isFinite(perPartner) && perPartner > 0) {
    limits.push(perPartner);
  }
  if (limits.length === 0) return null;
  return Math.min(...limits);
};

/**
 * Single source of truth for "is this partner full?". Used by BOTH the automatic
 * assignment candidate filter and the manual assignment guard so the eligibility
 * rule can never drift between the two workflows. No limit (null) → never full.
 */
export const isAtCapacity = (activeJobs: number, maxJobs: number | null): boolean =>
  maxJobs != null && activeJobs >= maxJobs;

export type CapacityTransition = "paused" | "reopened" | "clear_flag" | null;

export interface CapacityDecision {
  transition: CapacityTransition;
  availabilityStatus: "open" | "paused";
  capacityPaused: boolean;
}

export const decideCapacityTransition = (input: {
  availabilityStatus: "open" | "paused";
  capacityPaused: boolean;
  activeJobs: number;
  maxJobs: number | null;
}): CapacityDecision => {
  const { availabilityStatus, capacityPaused, activeJobs, maxJobs } = input;
  const atCapacity = isAtCapacity(activeJobs, maxJobs);

  if (atCapacity && availabilityStatus === "open") {
    return { transition: "paused", availabilityStatus: "paused", capacityPaused: true };
  }
  if (!atCapacity && capacityPaused && availabilityStatus === "paused") {
    return { transition: "reopened", availabilityStatus: "open", capacityPaused: false };
  }
  if (!atCapacity && capacityPaused && availabilityStatus !== "paused") {
    return { transition: "clear_flag", availabilityStatus, capacityPaused: false };
  }
  return { transition: null, availabilityStatus, capacityPaused };
};

/** Count a partner's currently-active (capacity-consuming) jobs. */
export const countActiveJobs = async (printerId: string): Promise<number> => {
  return Order.countDocuments({
    assignedPrinter: new mongoose.Types.ObjectId(String(printerId)),
    status: { $in: ACTIVE_ORDER_STATUSES as any },
  });
};

export type CapacitySyncResult = {
  printerId: string;
  activeJobs: number;
  maxJobs: number | null;
  availabilityStatus: "open" | "paused";
  /**
   * At or over the job limit right now, so the partner cannot switch themselves
   * back to Open. Independent of *why* they are paused.
   */
  capacityLocked: boolean;
  /**
   * The system paused them, and will reopen them by itself once their load
   * drops. False for a pause a person chose — which is never auto-reopened.
   */
  capacityPaused: boolean;
  changed: boolean;
  transition: "paused" | "reopened" | null;
};

/**
 * Reconcile a partner's availability with their current active-job load.
 *
 *  • At or above the limit while Open  → auto-pause (capacityPaused = true),
 *    notify the partner, and broadcast the change to admin + printer clients.
 *  • Below the limit while capacity-paused → auto-reopen (capacityPaused = false),
 *    notify, and broadcast.
 *
 * A manual pause (capacityPaused = false) is never auto-reopened, and a
 * Best-effort: notification / broadcast
 * failures never throw.
 */
export const syncPartnerCapacity = async (
  printerId: string,
  preloadedSettings?: PartnerAssignmentSettings
): Promise<CapacitySyncResult | null> => {
  const id = String(printerId);
  const partner = await User.findOne({ _id: id, role: UserRoles.PRINTER }).select(
    "availabilityStatus capacityPaused settings.jobCapacity companyName name"
  );
  if (!partner) return null;

  const settings = preloadedSettings ?? (await getAssignmentSettings());
  const maxJobs = getEffectiveMaxConcurrent(partner as any, settings);
  const activeJobs = await countActiveJobs(id);
  const currentStatus = ((partner as any).availabilityStatus ?? "open") as "open" | "paused";
  const wasCapacityPaused = Boolean((partner as any).capacityPaused);

  const decision = decideCapacityTransition({
    availabilityStatus: currentStatus,
    capacityPaused: wasCapacityPaused,
    activeJobs,
    maxJobs,
  });

  const newStatus = decision.availabilityStatus;
  const transition: "paused" | "reopened" | null =
    decision.transition === "paused" ? "paused" : decision.transition === "reopened" ? "reopened" : null;
  // "paused"/"reopened" are user-visible; "clear_flag" is a silent bookkeeping write.
  const changed = decision.transition === "paused" || decision.transition === "reopened";

  if (decision.transition !== null) {
    (partner as any).availabilityStatus = decision.availabilityStatus;
    (partner as any).capacityPaused = decision.capacityPaused;
    await partner.save();
  }

  /*
   * These are two different facts and were reported as one.
   *
   * `capacityLocked` was `capacityPaused`, so a partner who paused *themselves*
   * while at their limit was told they could switch back to Open — the server
   * then answered 409. And the badge read the same flag to say "paused
   * automatically, you'll reopen automatically", which for a manual pause was
   * simply untrue: the monitor only auto-reopens a pause it made itself.
   */
  const capacityPaused = Boolean((partner as any).capacityPaused);
  const capacityLocked = isAtCapacity(activeJobs, maxJobs);
  const result: CapacitySyncResult = {
    printerId: id,
    activeJobs,
    maxJobs,
    availabilityStatus: newStatus,
    capacityLocked,
    capacityPaused,
    changed,
    transition,
  };

  if (changed) {
    // Live-sync both portals so neither needs a manual refresh.
    broadcastToAllAdmins("partner.availability_changed", {
      partnerId: id,
      availabilityStatus: newStatus,
      capacityLocked,
      capacityPaused,
      activeJobs,
      maxJobs,
    });
    publishPrinterNotificationEvent(id, "availability.changed", {
      availabilityStatus: newStatus,
      capacityLocked,
      capacityPaused,
      activeJobs,
      maxJobs,
      reason: transition === "paused" ? "capacity_reached" : "capacity_recovered",
    });

    if (transition === "paused") {
      notifyPrinter({
        printerId: id,
        category: "jobs",
        priority: "medium",
        title: "Maximum job capacity reached",
        message:
          `You've reached your maximum of ${maxJobs} active ${maxJobs === 1 ? "job" : "jobs"}. ` +
          `Your status was automatically set to Paused, so no new jobs will be auto-assigned. ` +
          `You'll be switched back to Open automatically once your active job count drops below ${maxJobs}.`,
        meta: { type: "capacity_paused", activeJobs, maxJobs },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    } else if (transition === "reopened") {
      notifyPrinter({
        printerId: id,
        category: "jobs",
        priority: "low",
        title: "You're available again",
        message:
          `Your active job count dropped below your limit of ${maxJobs}, so your status was ` +
          `automatically set back to Open. You're eligible for auto-assigned jobs again.`,
        meta: { type: "capacity_recovered", activeJobs, maxJobs },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }
  }

  return result;
};

/** Fire-and-forget wrapper — safe to call after any order-status transition. */
export const syncPartnerCapacitySafe = (printerId: string | null | undefined): void => {
  if (!printerId) return;
  syncPartnerCapacity(String(printerId)).catch((err) => {
    console.error(`[CAPACITY_SYNC] failed for printer ${printerId}: ${err?.message}`);
  });
};
