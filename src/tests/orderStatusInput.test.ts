import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveOrderStatusInput,
  resolveOrderPriorityInput,
} from "../utils/orderStatusInput.js";

/**
 * There were FOUR copies of this map — listOrders, updateOrderStatus,
 * exportOrders and getPartnerOrders. Every one of them mapped "Assigned" to
 * PENDING, which became wrong the moment assignment started setting PROCESSING:
 * the console's own label for that state resolved to its opposite. None
 * accepted PROCESSING or QUALITY_CHECK at all.
 */

describe("order status input", () => {
  it("maps the console's label for an assigned order to PROCESSING, not PENDING", () => {
    assert.equal(resolveOrderStatusInput("Assigned"), "PROCESSING");
  });

  it("resolves every display label the console shows", () => {
    assert.equal(resolveOrderStatusInput("Unassigned"), "PENDING");
    assert.equal(resolveOrderStatusInput("Printing"), "PRINTING");
    assert.equal(resolveOrderStatusInput("Ready to Ship"), "QUALITY_CHECK");
    assert.equal(resolveOrderStatusInput("Shipped"), "SHIPPED");
    assert.equal(resolveOrderStatusInput("Completed"), "COMPLETED");
    assert.equal(resolveOrderStatusInput("Cancelled"), "CANCELLED");
  });

  it("resolves the states that previously had no mapping at all", () => {
    assert.equal(resolveOrderStatusInput("PROCESSING"), "PROCESSING");
    assert.equal(resolveOrderStatusInput("QUALITY_CHECK"), "QUALITY_CHECK");
  });

  it("accepts raw backend values, which is what the tabs actually send", () => {
    for (const v of ["PENDING", "PRINTING", "SHIPPED", "COMPLETED", "CANCELLED"]) {
      assert.equal(resolveOrderStatusInput(v), v);
    }
  });

  it("is case-insensitive on raw values", () => {
    assert.equal(resolveOrderStatusInput("pending"), "PENDING");
    assert.equal(resolveOrderStatusInput("quality_check"), "QUALITY_CHECK");
  });

  it("returns null for anything unrecognised, rather than inventing a status", () => {
    for (const v of ["", "  ", "Rejected", "Paused", "nonsense", null, undefined]) {
      assert.equal(resolveOrderStatusInput(v), null, String(v));
    }
  });
});

describe("order priority input", () => {
  it("accepts both cases", () => {
    assert.equal(resolveOrderPriorityInput("urgent"), "URGENT");
    assert.equal(resolveOrderPriorityInput("URGENT"), "URGENT");
    assert.equal(resolveOrderPriorityInput("Normal"), "NORMAL");
  });

  it("rejects anything else", () => {
    for (const v of ["high", "low", "", null, undefined, "rush"]) {
      assert.equal(resolveOrderPriorityInput(v), null, String(v));
    }
  });
});
