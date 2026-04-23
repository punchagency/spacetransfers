export interface DashboardStatCard {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
}

export type DashboardJobStatus =
  | "Urgent"
  | "Pending"
  | "Processing"
  | "Printing"
  | "Quality Check"
  | "Completed"
  | "Cancelled";

export interface DashboardJob {
  id: string;
  customerName: string;
  order: string;
  deadline: string;
  status: DashboardJobStatus;
  isUrgent?: boolean;
  createdAt?: string | null;
}
