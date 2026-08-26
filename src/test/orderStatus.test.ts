import { describe, it, expect } from "vitest";
import {
  ORDER_STATUS_LABEL,
  formatOrderStatus,
  orderStatusBadgeClass,
  orderStatusTextColor,
} from "../utils/orderStatus";
import { mapAdminOrderToRow } from "../utils/orderMappers";

/**
 * One order read four different ways: the table said "Assigned", the detail
 * header showed the raw "PROCESSING", the timeline printed the raw recorded
 * value, and the timeline's fallback steps called it "Payment Verified" — a
 * label for something the platform does not do.
 */

describe("order status labels", () => {
  it("gives one label per backend status", () => {
    expect(formatOrderStatus("PENDING")).toBe("Unassigned");
    expect(formatOrderStatus("PROCESSING")).toBe("Assigned");
    expect(formatOrderStatus("PRINTING")).toBe("Printing");
    expect(formatOrderStatus("QUALITY_CHECK")).toBe("Ready to Ship");
    expect(formatOrderStatus("SHIPPED")).toBe("Shipped");
    expect(formatOrderStatus("COMPLETED")).toBe("Completed");
    expect(formatOrderStatus("CANCELLED")).toBe("Cancelled");
  });

  it("covers every status the server can store", () => {
    // Mirrors the trimmed enum in order.model.ts.
    for (const s of [
      "PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK",
      "SHIPPED", "COMPLETED", "CANCELLED",
    ]) {
      expect(ORDER_STATUS_LABEL[s], `${s} has no label`).toBeTruthy();
    }
  });

  it("no longer calls PROCESSING 'Payment Verified'", () => {
    // Payment verification is not implemented and there is no payment status
    // on an order, so the old label described something that cannot happen.
    expect(Object.values(ORDER_STATUS_LABEL)).not.toContain("Payment Verified");
  });

  it("is case-insensitive and tolerates junk", () => {
    expect(formatOrderStatus("processing")).toBe("Assigned");
    expect(formatOrderStatus("  ")).toBe("  ");
    expect(formatOrderStatus(null)).toBe("—");
  });

  it("shows an unmapped status rather than hiding it", () => {
    // An unknown status is a bug worth seeing, not something to blank out.
    expect(formatOrderStatus("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("gives every status a colour and a badge", () => {
    for (const s of Object.keys(ORDER_STATUS_LABEL)) {
      expect(orderStatusTextColor(s)).toMatch(/^text-/);
      expect(orderStatusBadgeClass(s)).toMatch(/^bg-/);
    }
  });
});

describe("the table row uses the same labels as everything else", () => {
  const row = (status: string) =>
    mapAdminOrderToRow({ id: "1", createdAt: new Date().toISOString(), status, customer: "X" });

  it("labels an assigned order the way the detail header does", () => {
    expect(row("PROCESSING").status).toBe(formatOrderStatus("PROCESSING"));
  });

  it("no longer calls PRINTING 'Processing'", () => {
    // The Printing tab used to return rows labelled "Processing" while the
    // Processing tab returned rows labelled "Assigned".
    expect(row("PRINTING").status).toBe("Printing");
    expect(row("PROCESSING").status).not.toBe("Processing");
  });

  it("no longer calls SHIPPED 'Ready to Ship'", () => {
    expect(row("SHIPPED").status).toBe("Shipped");
  });
});
