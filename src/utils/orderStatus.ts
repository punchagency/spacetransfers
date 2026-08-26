/**
 * One name per order status, for every surface.
 *
 * The same order could read four different ways: the Orders table said
 * "Assigned", the detail header showed the raw "PROCESSING", the timeline
 * printed whatever raw value was recorded on the entry, and the timeline's
 * fallback step list called it "Payment Verified" — a label unrelated to what
 * the state means, and describing something the platform does not yet do.
 *
 * Backend values stay as they are. This is presentation only.
 */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Unassigned",
  // A partner is attached but has not started. "Assigned" is what an admin
  // needs to know; the backend name says nothing useful.
  PROCESSING: "Assigned",
  PRINTING: "Printing",
  QUALITY_CHECK: "Ready to Ship",
  SHIPPED: "Shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * Falls back to the raw value rather than hiding it: an unmapped status is a
 * bug worth seeing, not something to render as blank or "Unknown".
 */
export const formatOrderStatus = (status?: string | null): string => {
  const key = String(status || "").toUpperCase();
  return ORDER_STATUS_LABEL[key] || String(status || "—");
};

/** Tailwind text colour per status, keyed on the backend value. */
export const orderStatusTextColor = (status?: string | null): string => {
  switch (String(status || "").toUpperCase()) {
    case "PENDING":
      return "text-amber-500";
    case "PROCESSING":
      return "text-blue-600";
    case "PRINTING":
      return "text-indigo-600";
    case "QUALITY_CHECK":
      return "text-purple-600";
    case "SHIPPED":
      return "text-gray-900";
    case "COMPLETED":
      return "text-green-600";
    case "CANCELLED":
      return "text-gray-400";
    default:
      return "text-gray-500";
  }
};

/** Badge classes per status, for the detail header. */
export const orderStatusBadgeClass = (status?: string | null): string => {
  switch (String(status || "").toUpperCase()) {
    case "PENDING":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "PROCESSING":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "PRINTING":
      return "bg-indigo-100 text-indigo-700 border-indigo-200";
    case "QUALITY_CHECK":
      return "bg-purple-100 text-purple-700 border-purple-200";
    case "SHIPPED":
      return "bg-purple-100 text-purple-700 border-purple-200";
    case "COMPLETED":
      return "bg-green-100 text-green-700 border-green-200";
    case "CANCELLED":
      return "bg-gray-100 text-gray-600 border-gray-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
};
