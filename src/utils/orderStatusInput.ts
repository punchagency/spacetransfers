/**
 * Translates whatever a caller sends into a backend order status.
 *
 * There were two copies of this — one in `listOrders` for filtering, one in
 * `updateOrderStatus` for writing — and they drifted. Both mapped "Assigned" to
 * PENDING, which became wrong the moment assignment started setting PROCESSING:
 * the console's own label for that state pointed at its opposite. Neither
 * accepted PROCESSING or QUALITY_CHECK at all.
 *
 * Display labels and raw values both resolve, so a caller cannot be caught out
 * by which one it happens to hold.
 */
export const ORDER_STATUS_INPUT: Record<string, string> = {
  Pending: "PENDING",
  Unassigned: "PENDING",
  Assigned: "PROCESSING",
  Processing: "PROCESSING",
  "In Progress": "PRINTING",
  Printing: "PRINTING",
  "Ready to Ship": "QUALITY_CHECK",
  "Quality Check": "QUALITY_CHECK",
  Shipped: "SHIPPED",
  Completed: "COMPLETED",
  Cancelled: "CANCELLED",
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PRINTING: "PRINTING",
  QUALITY_CHECK: "QUALITY_CHECK",
  SHIPPED: "SHIPPED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

/** Returns null when the value maps to no known status. */
export const resolveOrderStatusInput = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return ORDER_STATUS_INPUT[raw] ?? ORDER_STATUS_INPUT[raw.toUpperCase()] ?? null;
};

/** NORMAL unless URGENT is explicitly asked for. */
export const resolveOrderPriorityInput = (value: unknown): "NORMAL" | "URGENT" | null => {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "URGENT") return "URGENT";
  if (raw === "NORMAL") return "NORMAL";
  return null;
};
