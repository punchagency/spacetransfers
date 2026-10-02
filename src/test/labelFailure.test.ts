import { describe, expect, it } from "vitest";
import { describeLabelFailure } from "../utils/labelFailure";

/**
 * A failed label used to leave the partner's job page silent. It now says what
 * happened in their terms — and, just as important, whether it's theirs to fix.
 */
describe("describeLabelFailure", () => {
  it("tells them an inactive shipping account is not their problem", () => {
    const d = describeLabelFailure("ShipStation POST /orders/createorder → HTTP 402: 402 Payment Required");
    expect(d.title).toMatch(/isn't active/);
    expect(d.theirs).toBe(false);
    expect(d.body).toMatch(/nothing is lost/);
  });

  it("recognises a refused login", () => {
    expect(describeLabelFailure("HTTP 401 Unauthorized").theirs).toBe(false);
    expect(describeLabelFailure("403 Forbidden").title).toMatch(/couldn't be reached/);
  });

  it("treats timeouts and gateway errors as temporary", () => {
    for (const e of ["request timed out", "ETIMEDOUT", "HTTP 503 Service Unavailable"]) {
      const d = describeLabelFailure(e);
      expect(d.title, e).toMatch(/didn't respond/);
      expect(d.theirs, e).toBe(true);
    }
  });

  it("points an address problem at support", () => {
    expect(describeLabelFailure("Invalid ship-to address").title).toMatch(/address was rejected/);
  });

  it("falls back to a plain message for anything else", () => {
    const d = describeLabelFailure("something unexpected");
    expect(d.title).toBe("The shipping label couldn't be created");
    expect(d.body).toMatch(/Try again/);
  });
});
