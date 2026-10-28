import { describe, expect, it } from "vitest";
import { describeLabelFailure } from "../utils/labelFailure";

/**
 * A failed label used to leave the partner's job page silent. It now says what
 * happened in their terms — and, just as important, whether it's theirs to fix.
 */
describe("describeLabelFailure", () => {
  it("tells them an inactive shipping account is not their problem", () => {
    const d = describeLabelFailure("EasyPost POST /shipments → HTTP 402: Insufficient funds");
    expect(d.title).toMatch(/isn't active/);
    expect(d.theirs).toBe(false);
    expect(d.body).toMatch(/nothing is lost/);
  });

  it("recognises a refused key", () => {
    expect(describeLabelFailure("EasyPost GET /shipments → HTTP 401: Unauthorized").theirs).toBe(false);
    expect(describeLabelFailure("403 Forbidden").title).toMatch(/couldn't be reached/);
  });

  it("treats timeouts, gateway errors and rate limits as temporary", () => {
    for (const e of ["EasyPost took too long to respond", "ETIMEDOUT", "→ HTTP 503: unavailable", "→ HTTP 429: slow down"]) {
      const d = describeLabelFailure(e);
      expect(d.title, e).toMatch(/didn't respond/);
      expect(d.theirs, e).toBe(true);
    }
  });

  it("asks the partner for their own missing business address", () => {
    const d = describeLabelFailure("There's no ship-from address: the partner has no business address on record.");
    expect(d.title).toMatch(/business address is missing/);
    expect(d.theirs).toBe(true);
  });

  it("says when labels aren't switched on yet, and that it isn't theirs", () => {
    for (const e of ["Shipping labels aren't set up yet. Space Transfers has been told.", "Buying labels is switched off in this environment."]) {
      expect(describeLabelFailure(e).theirs, e).toBe(false);
    }
  });

  it("points address, abroad and no-carrier problems at support", () => {
    expect(describeLabelFailure("EasyPost → HTTP 422: Address not found (street1: House number is missing)").title).toMatch(/address was rejected/);
    expect(describeLabelFailure("Labels can only be made for US addresses; this order is going to Canada.").title).toMatch(/abroad/);
    expect(describeLabelFailure("No carrier offered a rate for this parcel.").theirs).toBe(false);
  });

  it("explains a label cancelled by a reassignment", () => {
    expect(describeLabelFailure("This job was reassigned to you, so the previous label was cancelled. Create a new one from your address.").title).toMatch(/new label/);
  });

  it("falls back to a plain message for anything else", () => {
    const d = describeLabelFailure("something unexpected");
    expect(d.title).toBe("The shipping label couldn't be created");
    expect(d.body).toMatch(/Try again/);
  });
});
