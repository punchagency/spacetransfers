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
