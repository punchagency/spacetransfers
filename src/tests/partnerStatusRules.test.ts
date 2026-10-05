import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { partnerTransitionError } from "../utils/partnerStatusRules.js";

const ok = (from: string, to: string, label = false) => assert.equal(partnerTransitionError(from, to, label), null, `${from} → ${to}`);
const refused = (from: string, to: string, label = false) =>
  assert.equal(typeof partnerTransitionError(from, to, label), "string", `${from} → ${to}`);

describe("partner status rules", () => {
  it("allows the normal path forward", () => {
    ok("PROCESSING", "PRINTING");
    ok("PRINTING", "QUALITY_CHECK");
    ok("PROCESSING", "QUALITY_CHECK");
    ok("QUALITY_CHECK", "SHIPPED", true);
  });

  it("never lets a partner mark a job completed", () => {
    for (const from of ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "SHIPPED"]) refused(from, "COMPLETED", true);
    assert.match(String(partnerTransitionError("SHIPPED", "COMPLETED", true)), /carrier confirms delivery/);
  });

  it("only ships a job whose label exists", () => {
    refused("QUALITY_CHECK", "SHIPPED", false);
    refused("PROCESSING", "SHIPPED", true);
    refused("PRINTING", "SHIPPED", true);
  });

  it("never moves backwards or out of completed", () => {
    refused("PRINTING", "PROCESSING");
    refused("SHIPPED", "PRINTING");
    refused("COMPLETED", "SHIPPED", true);
    refused("PRINTING", "NONSENSE");
  });

  it("never lets a partner cancel the customer's order", () => {
    for (const from of ["PROCESSING", "PRINTING", "QUALITY_CHECK"]) refused(from, "CANCELLED");
  });

  it("allows repeating the current status", () => {
    ok("QUALITY_CHECK", "QUALITY_CHECK");
  });
});

import { isPartnerEarningRealized, payableOrderFilter } from "../services/partnerEarnings.service.js";

describe("which jobs a partner is paid for", () => {
  it("shipped and delivered jobs, and a cancelled job the admin chose to pay", () => {
    assert.equal(isPartnerEarningRealized({ status: "SHIPPED" }), true);
    assert.equal(isPartnerEarningRealized({ status: "COMPLETED" }), true);
    assert.equal(isPartnerEarningRealized({ status: "CANCELLED", cancellation: { partnerPaid: true } }), true);
    assert.equal(isPartnerEarningRealized({ status: "CANCELLED" }), false);
    assert.equal(isPartnerEarningRealized({ status: "PRINTING" }), false);
    assert.deepEqual(payableOrderFilter().$or[1], { status: "CANCELLED", "cancellation.partnerPaid": true });
  });
});
