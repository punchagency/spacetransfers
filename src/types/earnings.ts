/**
 * Where a job's money actually is, lining up one-for-one with the four cards
 * above the table.
 *
 * "Paid" used to mean nothing more than SHIPPED, so with no payouts in existence
 * every shipped job displayed as Paid to a partner who had never been paid.
 * "Scheduled" existed in the badge and the server never produced it.
 */
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

