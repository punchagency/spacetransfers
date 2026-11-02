import { describe, expect, it } from "vitest";
import { confirmCopy, timelineStepAction } from "../utils/statusActions";

describe("status confirmations", () => {
  it("names the order and says what can't be undone", () => {
    const accept = confirmCopy("In Progress - Printing", "DTF-0283");
    expect(accept.title).toBe("Accept and start DTF-0283?");
    expect(accept.body).toMatch(/can't go back to Pending Review/);
    expect(accept.confirmLabel).toBe("Accept & Start");
  });

  it("warns that requesting a label buys one, for every sheet", () => {
    const label = confirmCopy("Print Shipping Label", "DTF-0283");
    expect(label.body).toMatch(/every sheet on the order is printed/);
    expect(label.body).toMatch(/label is bought/);
  });

  it("says the customer is told when pickup is confirmed", () => {
    const shipped = confirmCopy("Order Shipped", "DTF-0283");
    expect(shipped.title).toMatch(/ready for pickup/);
    expect(shipped.body).toMatch(/customer is told/);
  });
});

describe("timelineStepAction", () => {
  it("offers Printing and Shipping Label on a job waiting to be accepted", () => {
    expect(timelineStepAction("PRINTING", "PROCESSING", false)).toBe("In Progress - Printing");
    expect(timelineStepAction("LABEL", "PROCESSING", false)).toBe("Print Shipping Label");
  });

  it("only moves forward", () => {
    expect(timelineStepAction("RECEIVED", "PRINTING", false)).toBeNull();
    expect(timelineStepAction("PRINTING", "PRINTING", false)).toBeNull();
    expect(timelineStepAction("LABEL", "PRINTING", false)).toBe("Print Shipping Label");
    expect(timelineStepAction("PRINTING", "QUALITY_CHECK", true)).toBeNull();
    expect(timelineStepAction("LABEL", "QUALITY_CHECK", true)).toBeNull();
  });

  it("offers Shipped only at the label step, once the label is ready", () => {
    expect(timelineStepAction("SHIPPED", "PRINTING", true)).toBeNull();
    expect(timelineStepAction("SHIPPED", "QUALITY_CHECK", false)).toBeNull();
    expect(timelineStepAction("SHIPPED", "QUALITY_CHECK", true)).toBe("Order Shipped");
  });

  it("never offers Delivered, and nothing on a finished or cancelled job", () => {
    expect(timelineStepAction("DELIVERED", "SHIPPED", true)).toBeNull();
    for (const status of ["SHIPPED", "COMPLETED", "CANCELLED"]) {
      for (const step of ["PRINTING", "LABEL", "SHIPPED", "DELIVERED"] as const) {
        expect(timelineStepAction(step, status, true)).toBeNull();
      }
    }
  });
});
