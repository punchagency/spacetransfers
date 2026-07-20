/**
 * Assignment SLA: a printer has exactly 24 hours from the moment a job is
 * assigned to them to fulfil it. This is the single source of truth for that
 * window — every assignment path and every read path computes the deadline
 * through here so the countdown and expiration logic can never drift.
 */
export const ASSIGNMENT_SLA_MS = 24 * 60 * 60 * 1000; // 24 hours

/** The deadline for a job assigned at `assignedAt` (assignedAt + 24h). */
export const computeAssignmentDeadline = (assignedAt: Date): Date =>
  new Date(assignedAt.getTime() + ASSIGNMENT_SLA_MS);

/**
 * The deadline to surface for an order, as an ISO string (or null when there is
 * no basis for one). Prefers the stored `assignmentDeadline`; falls back to
 * `assignedAt + 24h`, then to `createdAt + 24h` for legacy orders that predate
 * the assignment-timestamp fields.
 */
export const resolveOrderDeadlineIso = (order: {
  assignmentDeadline?: Date | string | null;
  assignedAt?: Date | string | null;
  createdAt?: Date | string | null;
}): string | null => {
  if (order?.assignmentDeadline) {
    const d = new Date(order.assignmentDeadline);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (order?.assignedAt) {
    const a = new Date(order.assignedAt);
    if (!Number.isNaN(a.getTime())) return computeAssignmentDeadline(a).toISOString();
  }
  if (order?.createdAt) {
    const c = new Date(order.createdAt);
    if (!Number.isNaN(c.getTime())) return computeAssignmentDeadline(c).toISOString();
  }
  return null;
};
