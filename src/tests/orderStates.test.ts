import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Order } from "../models/order.model.js";
import { ACTIVE_ORDER_STATUSES } from "../services/partnerCapacity.service.js";

/**
 * The order lifecycle had two competing state machines. `executeJobAction`
 * (ACCEPT/REJECT/START/PAUSE/RESUME) was the older one and no UI ever called
 * it, so REJECTED and PAUSED could never occur; `updatePrinterOrderStatus`
 * superseded it and is what the printer app uses.
 *
 * PROCESSING is now written by assignment, so PENDING means "no partner yet"
 * and nothing else.
 */

const statusEnum = (Order.schema.path("status") as any).enumValues as string[];

describe("order status enum", () => {
  it("contains only states something can actually reach", () => {
    assert.deepEqual(statusEnum, [
      "PENDING",
      "PROCESSING",
      "PRINTING",
      "QUALITY_CHECK",
      "SHIPPED",
      "COMPLETED",
      "CANCELLED",
    ]);
  });

  it("no longer allows the states nothing wrote", () => {
    for (const dead of ["REJECTED", "PAUSED", "PAID", "paid"]) {
      assert.ok(!statusEnum.includes(dead), `${dead} should be gone`);
    }
  });

  it("dropped the lower-case PAID duplicate that would have split queries", () => {
    const upper = statusEnum.map((s) => s.toUpperCase());
    assert.equal(new Set(upper).size, upper.length, "no case-variant duplicates");
  });

  it("defaults a new order to PENDING", () => {
    assert.equal((Order.schema.path("status") as any).defaultValue, "PENDING");
  });
});

describe("capacity accounting follows the enum", () => {
  it("counts every pre-terminal state as occupying a slot", () => {
    assert.deepEqual([...ACTIVE_ORDER_STATUSES], [
      "PENDING",
      "PROCESSING",
      "PRINTING",
      "QUALITY_CHECK",
    ]);
  });

  it("never counts a status the schema cannot store", () => {
    for (const s of ACTIVE_ORDER_STATUSES) {
      assert.ok(statusEnum.includes(s), `${s} is counted but not storable`);
    }
  });

  it("treats the terminal states as freeing the slot", () => {
    for (const terminal of ["SHIPPED", "COMPLETED", "CANCELLED"]) {
      assert.ok(!(ACTIVE_ORDER_STATUSES as readonly string[]).includes(terminal));
    }
  });
});
