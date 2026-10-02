/** Payout statuses as the API stores them, and what an admin may do in each. */
export type PayoutStatus =
  | "pending_review"
  | "pending"
  | "approved"
  | "processing"
  | "paid"
  | "rejected"
  | "failed"
  | "cancelled";

export type PayoutAction = "approve" | "reject" | "pay" | "retry";

const LABEL: Record<string, string> = {
  pending_review: "Awaiting review",
  pending: "Awaiting review",
  approved: "Approved",
  processing: "Paying",
  paid: "Paid",
  rejected: "Rejected",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const payoutStatusLabel = (status: string): string => LABEL[status] || status;

export const payoutStatusStyle = (status: string): string => {
  switch (status) {
    case "paid":
      return "bg-green-50 text-green-700 border-green-100";
    case "approved":
    case "processing":
      return "bg-blue-50 text-blue-700 border-blue-100";
    case "failed":
    case "rejected":
      return "bg-red-50 text-red-700 border-red-100";
    case "cancelled":
      return "bg-gray-50 text-gray-600 border-gray-200";
    default:
      return "bg-amber-50 text-amber-800 border-amber-100";
  }
};

/** Mirrors the API's rules, so a button is only offered when the API will accept it. */
export const payoutActions = (status: string): PayoutAction[] => {
  switch (status) {
    case "pending_review":
    case "pending":
      return ["approve", "reject"];
    case "approved":
      return ["pay", "reject"];
    case "failed":
      return ["retry", "reject"];
    default:
      return [];
  }
};
