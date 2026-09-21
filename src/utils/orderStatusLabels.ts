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
