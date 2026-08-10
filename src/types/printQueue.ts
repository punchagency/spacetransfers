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

export type LabelSize = "4x6" | "4x4" | "2x4";

export type ExportFormat = "PDF" | "PNG" | "TIFF";

export type Resolution = "150" | "300" | "600" | "1200";

export interface ExportSettingsState {
  cropMarks: boolean;
  colorBars: boolean;
  embedICC: boolean;
}

