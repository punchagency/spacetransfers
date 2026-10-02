/**
 * Which status moves a print partner may make.
 *
 * Forward-only. Cancelling is always allowed. COMPLETED means delivered and
 * makes the job payable, so only the carrier's delivery confirmation sets it.
 * SHIPPED needs the job's shipping label to exist.
 */
const RANK: Record<string, number> = {
  PENDING: 0,
  PROCESSING: 1,
  PRINTING: 2,
  QUALITY_CHECK: 3,
  SHIPPED: 4,
  COMPLETED: 5,
};

/** Why the move is refused, or null when it is allowed. */
export const partnerTransitionError = (current: string, next: string, hasLabel: boolean): string | null => {
  if (next === current) return null;
  if (next === "CANCELLED") return null;
  const from = RANK[current] ?? -1;
  const to = RANK[next] ?? -1;
  if (current === "COMPLETED" || from < 0 || to < 0 || to <= from) {
    return `Invalid status transition from ${current} to ${next}`;
  }
  if (next === "COMPLETED") return "Jobs complete automatically when the carrier confirms delivery.";
  if (next === "SHIPPED" && (current !== "QUALITY_CHECK" || !hasLabel)) {
    return "A job can be marked shipped once its shipping label is ready.";
  }
  return null;
};
