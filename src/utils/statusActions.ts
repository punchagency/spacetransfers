/**
 * What each status step means, asked the same way from the job list and the job
 * page. Every move is forward-only, so the question says what can't be undone.
 */
export type ConfirmableStep = "In Progress - Printing" | "Print Shipping Label" | "Order Shipped";

export const confirmCopy = (
  step: ConfirmableStep,
  orderNumber: string,
): { title: string; body: string; confirmLabel: string } => {
  switch (step) {
    case "In Progress - Printing":
      return {
        title: `Accept and start ${orderNumber}?`,
        body:
          "You're taking this job and starting to print it. The print-by clock starts now, and the job can't go back to Pending Review.",
        confirmLabel: "Accept & Start",
      };
    case "Print Shipping Label":
      return {
        title: `Request the shipping label for ${orderNumber}?`,
        body:
          "Only do this once every sheet on the order is printed. A shipping label is bought for this order, and the job can't go back to printing.",
        confirmLabel: "Request Label",
      };
    case "Order Shipped":
      return {
        title: `Confirm ${orderNumber} is ready for pickup?`,
        body:
          "Check the shipping label is attached to the package. The job is marked shipped and the customer is told it's on its way.",
        confirmLabel: "Confirm Ready for Pickup",
      };
  }
};

export type TimelineStepKey = "RECEIVED" | "PRINTING" | "LABEL" | "SHIPPED" | "DELIVERED";

const STATUS_RANK: Record<string, number> = { PENDING: 0, PROCESSING: 1, PRINTING: 2, QUALITY_CHECK: 3 };

/**
 * The move a timeline step makes from the job's current status, or null when
 * the step can't be chosen. The same moves the Update Status card offers:
 * forward only, shipped only once the label is ready, delivered never.
 */
export const timelineStepAction = (
  step: TimelineStepKey,
  status: string,
  labelReady: boolean,
): ConfirmableStep | null => {
  const rank = STATUS_RANK[String(status).toUpperCase()];
  if (rank === undefined) return null;
  if (step === "PRINTING") return rank < STATUS_RANK.PRINTING ? "In Progress - Printing" : null;
  if (step === "LABEL") return rank < STATUS_RANK.QUALITY_CHECK ? "Print Shipping Label" : null;
  if (step === "SHIPPED") return rank === STATUS_RANK.QUALITY_CHECK && labelReady ? "Order Shipped" : null;
  return null;
};
