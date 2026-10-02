import { describe, expect, it } from "vitest";
import { payoutActions, payoutStatusLabel } from "../utils/payouts";

describe("payout statuses", () => {
  it("offers only the steps the API accepts", () => {
    expect(payoutActions("pending_review")).toEqual(["approve", "reject"]);
    expect(payoutActions("approved")).toEqual(["pay", "reject"]);
    expect(payoutActions("failed")).toEqual(["retry", "reject"]);
    for (const done of ["paid", "rejected", "processing", "cancelled"]) expect(payoutActions(done)).toEqual([]);
  });

  it("never pays a payout that hasn't been approved", () => {
    expect(payoutActions("pending_review")).not.toContain("pay");
  });

  it("names statuses in plain words", () => {
    expect(payoutStatusLabel("pending_review")).toBe("Awaiting review");
    expect(payoutStatusLabel("pending")).toBe("Awaiting review");
    expect(payoutStatusLabel("processing")).toBe("Paying");
  });
});
