
export type DashboardJobStatus =
  | "Urgent"
  | "Pending"
  | "Processing"
  | "Printing"
  | "Print Shipping Label"
  | "Completed"
  | "Cancelled";

export interface DashboardJob {
  id: string;
  displayId?: string | null;
  customerName: string;
  order: string;
  /** When the next step is due, and which step; null once nothing is due. */
  deadline: string | null;
  dueStage?: "ACCEPT" | "PRINT" | null;
  status: DashboardJobStatus;
  isUrgent?: boolean;
  createdAt?: string | null;
}
