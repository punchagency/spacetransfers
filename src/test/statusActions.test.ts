import { describe, expect, it } from "vitest";
import { confirmCopy } from "../utils/statusActions";

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
