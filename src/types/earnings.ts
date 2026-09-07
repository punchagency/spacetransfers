export type EarningsJobStatus = "Paid" | "Pending" | "Scheduled";

export interface EarningsJobDetails {
  title: string;
  sub: string;
}

export interface EarningsJob {
  id: string;
  customer: string;
  details: EarningsJobDetails;
  completed: string;
  earning: string;
  status: EarningsJobStatus;
}

export type EarningsTimeFilter = "Today" | "This Week" | "This Month" | "All Time";

