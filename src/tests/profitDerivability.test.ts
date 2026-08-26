import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canDerivePartnerEarning,
  isPartnerEarningRealized,
  PAYOUT_ELIGIBLE_ORDER_STATUSES,
} from "../services/partnerEarnings.service.js";
import { computePartnerCostBreakdown } from "../utils/partnerPricingCost.js";

/**
 * An order with no sheet dimensions has an *unknown* partner cost, not a zero
 * one. Collapsing the two made the admin dashboard report `total - 0` and so
 * show 100% margin on orders it had no cost data for — DTF-0242 through 0247
 * all displayed profit equal to their full amount.
 *
 * The code before that charged a flat $5.00 per dimensionless item, which was
 * not a real cost either, just a less visible invention.
 */

const order = (items: unknown[]) => ({ items });

describe("partner cost derivability", () => {
  it("is derivable when a sheet has real dimensions", () => {
    assert.equal(canDerivePartnerEarning(order([{ widthIn: 24, heightIn: 36, quantity: 1 }])), true);
  });

  it("accepts the sheet* field names the cost function prefers", () => {
    assert.equal(
      canDerivePartnerEarning(order([{ sheetWidthIn: 24, sheetHeightIn: 36, quantity: 1 }])),
      true,
    );
  });

  it("is NOT derivable for the dimensionless orders that caused this", () => {
    // The exact shape of DTF-0242..0247.
    assert.equal(canDerivePartnerEarning(order([{ quantity: 1, unitPrice: 5 }])), false);
  });

  it("is not derivable for zero or negative dimensions", () => {
    assert.equal(canDerivePartnerEarning(order([{ widthIn: 0, heightIn: 36 }])), false);
    assert.equal(canDerivePartnerEarning(order([{ widthIn: -24, heightIn: 36 }])), false);
  });

  it("is not derivable for an order with no items at all", () => {
    assert.equal(canDerivePartnerEarning(order([])), false);
    assert.equal(canDerivePartnerEarning({}), false);
  });

  it("is derivable if any one line has dimensions", () => {
    assert.equal(
      canDerivePartnerEarning(order([{ quantity: 1 }, { widthIn: 12, heightIn: 12, quantity: 1 }])),
      true,
    );
  });

  it("agrees with the cost function: underivable is exactly where cost would be 0", () => {
    const dimensionless = [{ quantity: 2, unitPrice: 10 }];
    assert.equal(canDerivePartnerEarning(order(dimensionless)), false);
    assert.equal(
      computePartnerCostBreakdown({
        items: dimensionless,
        partnerPricing: { baseRatePerSqFt: 2.5 },
        priority: null,
        adjustments: [],
      }).subtotal,
      0,
      "if this ever returns non-zero, the derivability check is now wrong",
    );
  });
});

describe("profit is a forecast until the order ships", () => {
  it("is not realized for any pre-shipment status", () => {
    for (const status of ["PENDING", "PROCESSING", "PRINTING", "CANCELLED", "REJECTED"]) {
      assert.equal(isPartnerEarningRealized({ status }), false, status);
    }
  });

  it("is realized exactly for the statuses that can actually be paid out", () => {
    for (const status of PAYOUT_ELIGIBLE_ORDER_STATUSES) {
      assert.equal(isPartnerEarningRealized({ status }), true, status);
    }
    // Pinned to the payout list rather than a second copy of it, so the table
    // cannot start calling a margin settled before the partner can be paid.
    assert.deepEqual([...PAYOUT_ELIGIBLE_ORDER_STATUSES], ["SHIPPED", "COMPLETED"]);
  });

  it("treats a missing status as not realized", () => {
    assert.equal(isPartnerEarningRealized({}), false);
    assert.equal(isPartnerEarningRealized(null), false);
  });
});

describe("the financials panel gets the same treatment as the table", () => {
  it("has one derivability rule shared by every profit surface", () => {
    // Four surfaces compute margin: the dashboard's recent orders, listOrders,
    // getOrderFinancials, and the order-detail endpoint behind the Invoice &
    // Financials panel. The last was missed on the first pass and reported
    // `customerPaid - 0` for a dimensionless order.
    const dimensionless = { items: [{ quantity: 1, unitPrice: 38.5 }] };
    const real = { items: [{ widthIn: 24.34, heightIn: 65.09, quantity: 1 }] };
    assert.equal(canDerivePartnerEarning(dimensionless), false);
    assert.equal(canDerivePartnerEarning(real), true);
  });

  it("keeps 'unknown cost' separate from 'not settled yet'", () => {
    // A dimensionless SHIPPED order is settled but still has no cost; a
    // dimensioned PENDING one has a cost that is merely an estimate. The panel
    // renders "—" for the first and "est." for the second.
    const shippedNoDims = { status: "SHIPPED", items: [{ quantity: 1 }] };
    const pendingWithDims = { status: "PENDING", items: [{ widthIn: 12, heightIn: 12, quantity: 1 }] };
    assert.equal(canDerivePartnerEarning(shippedNoDims), false);
    assert.equal(isPartnerEarningRealized(shippedNoDims), true);
    assert.equal(canDerivePartnerEarning(pendingWithDims), true);
    assert.equal(isPartnerEarningRealized(pendingWithDims), false);
  });
});
