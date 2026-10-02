export type PrintStatus =
  | "Pending"
  | "Processing"
  | "Printing"
  | "Print Shipping Label"
  | "Completed"
  | "Urgent";

export type PrintPriority = "Urgent";

export interface PrintJob {
  id: string;
  orderId: string;
  customer: string;
  sheetSize: string;
  orderDescription: string;
  status: PrintStatus;
  /** ISO fulfilment deadline (assignment time + 24h). */
  deadline: string;
  /** ISO order-created timestamp. */
  createdAt?: string;
  priority?: PrintPriority;
}
