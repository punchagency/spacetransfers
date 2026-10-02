export type EarningsJobStatus = "Paid" | "Scheduled" | "Available" | "Pending";

export interface EarningsJobDetails {
  title: string;
  sub: string;
}

export interface EarningsJob {
  /** The order's real id, so a row can link to the job. */
  id: string;
  /** The human-readable order number, or null if one was never issued. */
  displayId: string | null;
  customer: string;
  details: EarningsJobDetails;
  /** ISO completion time, or null for a job that has not shipped. */
  completedAt: string | null;
  earning: string;
  status: EarningsJobStatus;
  /** The job's own workflow status, for context beside the payout status. */
  orderStatus: string;
}

export type EarningsTimeFilter =
  | "Today"
  | "This Week"
  | "This Month"
  // Calendar year to date, the same window the dashboard's YTD uses.
  | "This Year"
  | "All Time";

