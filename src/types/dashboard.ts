
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
  deadline: string;
  status: DashboardJobStatus;
  isUrgent?: boolean;
  createdAt?: string | null;
}
