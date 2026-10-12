import type { JobIssueFlag } from "../utils/jobIssues";

export type OrderStatus =
  | "Pending Review"
  | "In Progress - Printing"
  | "Print Shipping Label"
  | "Order Shipped"
  | "Completed"
  | "Cancelled";

export interface Order {
  id: string;
  actualId?: string;
  displayId?: string;
  customerName: string;
  isUrgent: boolean;
  thumbnail: string;
  sheetSize: string;
  filmType: string;
  dueDate: string;
  /** When the next step is due (ISO), and which step: accept, then print. */
  deadline?: string | null;
  dueStage?: "ACCEPT" | "PRINT" | null;
  location: string;
  status: OrderStatus;
  statusDescription?: string;
  /** Set while Space Transfers has an open question about a problem on this job. */
  issue?: JobIssueFlag | null;
}

export type OrdersTabLabel =
  | "All Jobs"
  // "Pending Review", matching PRINTER_STATUS_LABEL — the tab alone said
  // "Pending" while every other surface named the same state in full.
  | "Pending Review"
  | "In Progress - Printing"
  | "Print Shipping Label"
  | "Order Shipped"
  | "Completed"
  | "Cancelled";

export interface OrdersTab {
  label: OrdersTabLabel;
  count: number;
}
