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
