import type { SlaSettings } from "../services/partnerCapacity.service.js";

/**
 * When each stage of a job was due, and whether it is late.
 *
 * Kept pure and free of Mongo so the decision to move someone's work can be
 * tested exhaustively. The sweeper only queries and acts; every judgement about
 * *whether* to act is made here.
 *
 * There has been an SLA in the codebase all along — `ASSIGNMENT_SLA_MS`, a flat
 * 24 hours, computed at assignment, stored on the order and shown to the partner
 * as a countdown. Nothing ever read it back. It was a clock with no consequence,
 * and it ran at the same speed for a rush job as for a normal one.
 */

export type SlaStage = "ACCEPT" | "PRINT";

export interface SlaBreach {
  stage: SlaStage;
  /** Reassignment is only ever safe for ACCEPT — see `slaAction`. */
  action: "REASSIGN" | "ESCALATE";
  dueAt: Date;
  overdueMs: number;
  hoursAllowed: number;
}

const HOUR_MS = 60 * 60 * 1000;

const isUrgent = (priority: unknown): boolean =>
  String(priority ?? "").trim().toUpperCase() === "URGENT";

/** Hours allowed for a stage, given the order's priority. */
export const hoursForStage = (
  stage: SlaStage,
  priority: unknown,
  sla: SlaSettings,
): number => {
  const band = stage === "ACCEPT" ? sla.acceptHours : sla.printHours;
  return isUrgent(priority) ? band.urgent : band.normal;
};

/**
 * A job on the press is never taken away automatically.
 *
 * The partner may have film loaded and half a sheet run. Reassigning it means
 * the work is printed twice and paid for twice, and the platform cannot tell
 * from the outside which it is. A human decides.
 */
export const slaAction = (stage: SlaStage): "REASSIGN" | "ESCALATE" =>
  stage === "ACCEPT" ? "REASSIGN" : "ESCALATE";

/** When the order most recently entered a status, from its timeline. */
export const enteredStatusAt = (
  order: { statusTimeline?: Array<{ status?: string; time?: Date | string }> },
  status: string,
): Date | null => {
  const entries = Array.isArray(order?.statusTimeline) ? order.statusTimeline : [];
  let latest: Date | null = null;
  for (const e of entries) {
    if (String(e?.status || "").toUpperCase() !== status) continue;
    const t = e?.time ? new Date(e.time) : null;
    if (t && !Number.isNaN(t.getTime()) && (!latest || t > latest)) latest = t;
  }
  return latest;
};

/**
 * How many times the SLA has already moved this job.
 *
 * Counted from the audit trail rather than a counter field, so it cannot drift
 * from what actually happened. Without a cap a job nobody wants bounces around
 * the network indefinitely, collecting reassignments and never being printed.
 */
export const slaReassignmentCount = (order: {
  assignmentHistory?: Array<{ reason?: string }>;
}): number =>
  (Array.isArray(order?.assignmentHistory) ? order.assignmentHistory : []).filter((h) =>
    String(h?.reason || "").startsWith(SLA_REASON_PREFIX),
  ).length;

export const SLA_REASON_PREFIX = "SLA breach";

/**
 * The breach for an order, or null if it is on time, not in a timed stage, or
 * the clock has no start.
 */
export const evaluateSla = (
  order: {
    status?: string;
    priority?: string;
    assignedAt?: Date | string | null;
    assignmentDeadline?: Date | string | null;
    statusTimeline?: Array<{ status?: string; time?: Date | string }>;
  },
  sla: SlaSettings,
  now: Date = new Date(),
): SlaBreach | null => {
  const status = String(order?.status || "").toUpperCase();

  const stage: SlaStage | null =
    status === "PROCESSING" ? "ACCEPT" : status === "PRINTING" ? "PRINT" : null;
  if (!stage) return null;

  /*
   * ACCEPT runs from assignment; PRINT runs from when printing actually began.
   * Falling back to `assignedAt` for PRINT would start the print clock before
   * the partner had the job, so a slow acceptance would eat the print window.
   */
  const startedAt =
    stage === "ACCEPT"
      ? order.assignedAt
        ? new Date(order.assignedAt)
        : null
      : enteredStatusAt(order, "PRINTING");

  if (!startedAt || Number.isNaN(startedAt.getTime())) return null;

  const hoursAllowed = hoursForStage(stage, order.priority, sla);

  /**
   * ACCEPT honours the deadline stored at assignment; only PRINT is derived
   * from the current settings.
   *
   * Recomputing ACCEPT from live settings meant tightening the window took work
   * away from partners who were told they had longer — and the countdown in
   * their own app still showed the old figure, because that reads the stored
   * value. Two sources of truth, disagreeing, with someone's job in the middle.
   * Honouring the stored deadline makes the promise and the enforcement the
   * same number, and a shortened window applies from the next assignment on.
   */
  const stored = stage === "ACCEPT" && order.assignmentDeadline ? new Date(order.assignmentDeadline) : null;
  const dueAt =
    stored && !Number.isNaN(stored.getTime())
      ? stored
      : new Date(startedAt.getTime() + hoursAllowed * HOUR_MS);

  const overdueMs = now.getTime() - dueAt.getTime();
  if (overdueMs <= 0) return null;

  return { stage, action: slaAction(stage), dueAt, overdueMs, hoursAllowed };
};

/**
 * Whether a breach should actually reassign, given how often it already has.
 *
 * A capped-out job escalates instead: it still needs a human, it just stops
 * being passed around while it waits for one.
 */
export const resolveBreachAction = (
  breach: SlaBreach,
  reassignmentsSoFar: number,
  sla: SlaSettings,
): { action: "REASSIGN" | "ESCALATE"; reason: string } => {
  if (breach.action === "ESCALATE") {
    return {
      action: "ESCALATE",
      reason: `${SLA_REASON_PREFIX}: on the press longer than ${breach.hoursAllowed}h — not reassigned, a partner may already have film loaded`,
    };
  }
  if (reassignmentsSoFar >= sla.maxAutoReassignments) {
    return {
      action: "ESCALATE",
      reason: `${SLA_REASON_PREFIX}: unstarted after ${breach.hoursAllowed}h and already reassigned ${reassignmentsSoFar} time(s) — needs a human`,
    };
  }
  return {
    action: "REASSIGN",
    reason: `${SLA_REASON_PREFIX}: not started within ${breach.hoursAllowed}h of assignment`,
  };
};
