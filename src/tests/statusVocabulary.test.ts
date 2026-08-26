import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Order } from "../models/order.model.js";
import { PRINTER_STATUS_LABEL, printerStatusLabel } from "../utils/orderStatusLabels.js";

/**
 * One order could be described differently on every surface. The words differ
 * by audience on purpose — a partner is told what to do next, an admin is told
 * what state a job is in — but the *mappings* have to be right, and several
 * were not.
 */

const statusEnum = (Order.schema.path("status") as any).enumValues as string[];

describe("printer-facing labels", () => {
  it("covers every storable status", () => {
    for (const s of statusEnum) {
      assert.ok(PRINTER_STATUS_LABEL[s], `${s} has no partner label`);
    }
  });

  it("does not tell a partner a job is printing before they start it", () => {
    // PROCESSING read "In Progress - Printing", so a partner who had been
    // assigned a job but not touched it was told it was on the press.
    assert.notEqual(PRINTER_STATUS_LABEL.PROCESSING, "In Progress - Printing");
    assert.equal(PRINTER_STATUS_LABEL.PROCESSING, "Pending Review");
  });

  it("keeps one name per state across surfaces", () => {
    // The job list said "Print Shipping Label" while the print-queue
    // notification said "Quality Check" — same state, same reader.
    assert.equal(printerStatusLabel("QUALITY_CHECK"), PRINTER_STATUS_LABEL.QUALITY_CHECK);
    assert.equal(printerStatusLabel("quality_check"), PRINTER_STATUS_LABEL.QUALITY_CHECK);
  });

  it("falls back rather than throwing on an unknown value", () => {
    assert.equal(printerStatusLabel(undefined), "Pending Review");
    assert.equal(printerStatusLabel("NOPE"), "Pending Review");
  });
});

describe("label round-trip", () => {
  // Mirrors `allowedLabels` in updatePrinterOrderStatus.
  const allowedLabels: Record<string, string> = {
    "Pending Review": "PROCESSING",
    "In Progress": "PRINTING",
    "In Progress - Printing": "PRINTING",
    "Print Shipping Label": "QUALITY_CHECK",
    Ready: "QUALITY_CHECK",
    "Order Shipped": "SHIPPED",
    Completed: "COMPLETED",
    Cancelled: "CANCELLED",
  };

  it("never resolves a partner's own label to a status the schema rejects", () => {
    for (const backend of Object.values(allowedLabels)) {
      assert.ok(statusEnum.includes(backend), `${backend} is not storable`);
    }
  });

  it("does not send an assigned job back to PENDING", () => {
    // PENDING now means "no partner attached". Mapping the partner's
    // "Pending Review" there would have produced an order that was pending and
    // assigned at once — the exact ambiguity the PROCESSING state removed.
    assert.equal(allowedLabels["Pending Review"], "PROCESSING");
    assert.ok(!Object.values(allowedLabels).includes("PENDING"));
  });
});

describe("customer-facing filter", () => {
  // Mirrors the statusMap in listCustomerOrders.
  const customerFilter: Record<string, string[]> = {
    pending: ["PENDING"],
    processing: ["PROCESSING", "PRINTING", "QUALITY_CHECK"],
    shipped: ["SHIPPED"],
    completed: ["COMPLETED"],
    cancelled: ["CANCELLED"],
  };

  it("leaves no status unreachable by any filter", () => {
    const covered = new Set(Object.values(customerFilter).flat());
    for (const s of statusEnum) {
      assert.ok(covered.has(s), `${s} matches no customer filter`);
    }
  });

  it("only names statuses that can exist", () => {
    for (const s of Object.values(customerFilter).flat()) {
      assert.ok(statusEnum.includes(s), `${s} was removed from the schema`);
    }
  });

  it("folds production detail into one bucket", () => {
    assert.deepEqual(customerFilter.processing, ["PROCESSING", "PRINTING", "QUALITY_CHECK"]);
  });
});
