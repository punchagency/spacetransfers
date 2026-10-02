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

  it("allows cancelling and repeating the current status", () => {
    ok("PRINTING", "CANCELLED");
    ok("QUALITY_CHECK", "QUALITY_CHECK");
  });
});
