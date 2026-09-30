/**
 * Server-side status labels, one map per audience.
 *
 * Three separate maps used to describe the same states to the same person:
 * the job list called QUALITY_CHECK "Print Shipping Label" while the print-queue
 * notification called it "Quality Check", and PROCESSING was "In Progress -
 * Printing" in one and "Processing" in the other. A partner could be told two
 * different things about one job depending on which surface they read.
 */

/**
 * What a print partner sees. Deliberately action-oriented — it says what to do
 * next, not what the database calls it.
 *
 * PROCESSING and PENDING share a label on purpose. A partner only ever sees
 * jobs assigned to them, so both mean the same thing from their seat: this job
 * is yours and you have not started it. PROCESSING previously read "In Progress
 * - Printing", which told a partner their job was on the press before they had
 * touched it.
 */
export const PRINTER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending Review",
  PROCESSING: "Pending Review",
  PRINTING: "In Progress - Printing",
  QUALITY_CHECK: "Print Shipping Label",
  SHIPPED: "Order Shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const printerStatusLabel = (status: unknown): string =>
  PRINTER_STATUS_LABEL[String(status || "").toUpperCase()] || "Pending Review";

/**
 * The inverse: which stored statuses each partner-facing label covers.
 *
 * Derived from the map above rather than written out again. The printer job
 * list kept its own copy and had `PROCESSING` under "In Progress - Printing" —
 * so a job a partner had not touched read "Pending Review" on Home and "In
 * Progress - Printing" on Jobs & Orders, and the tab counts followed the second
 * one. That is the exact defect the shared map exists to prevent, still live on
 * one page.
 */
export const PRINTER_LABEL_STATUSES: Record<string, string[]> = Object.entries(
  PRINTER_STATUS_LABEL,
).reduce<Record<string, string[]>>((acc, [status, label]) => {
  (acc[label] ||= []).push(status);
  return acc;
}, {});

/** The stored statuses behind a partner-facing label, or null if unrecognised. */
export const statusesForPrinterLabel = (label: unknown): string[] | null =>
  PRINTER_LABEL_STATUSES[String(label || "")] ?? null;

/**
 * What an admin calls each status — mirrors `ORDER_STATUS_LABEL` in the admin
 * app, so a timeline sentence written here uses the words on the admin's screen.
 */
export const ADMIN_STATUS_LABEL: Record<string, string> = {
  PENDING: "Unassigned",
  PROCESSING: "Assigned",
  PRINTING: "Printing",
  QUALITY_CHECK: "Ready to Ship",
  SHIPPED: "Shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** What a partner's move means, in words both apps recognise. */
const PARTNER_STEP_MESSAGE: Record<string, string> = {
  PROCESSING: "Partner moved the job back to not started",
  PRINTING: "Partner started printing",
  QUALITY_CHECK: "Partner finished printing and requested the shipping label",
  SHIPPED: "Partner confirmed the package is ready for pickup",
  CANCELLED: "Partner cancelled the job",
};

/**
 * The timeline sentence for a status change.
 *
 * These were "Printer updated status to QUALITY_CHECK" — a database code on the
 * admin's screen, for a step the partner's own app calls "Print Shipping Label"
 * and the admin's list calls "Ready to Ship".
 */
export const statusChangeMessage = (actor: "PRINTER" | "ADMIN", status: unknown): string => {
  const s = String(status || "").toUpperCase();
  if (actor === "PRINTER") return PARTNER_STEP_MESSAGE[s] || `Partner moved the job to ${printerStatusLabel(s)}`;
  return `Admin set the status to ${ADMIN_STATUS_LABEL[s] || s}`;
};

/** Rewrites the old raw-code sentences already stored on orders. */
export const describeTimelineMessage = (message: unknown): string | null => {
  if (typeof message !== "string" || !message) return null;
  const legacy = /^(Printer|Admin) updated status to ([A-Z_]+)$/.exec(message.trim());
  if (!legacy) return message;
  return statusChangeMessage(legacy[1] === "Printer" ? "PRINTER" : "ADMIN", legacy[2]);
};
