import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS, buildLegalAcceptancePayload } from "../utils/legal";

/**
 * What a print partner accepted, and which wording they accepted, is recorded
 * with their account — so the payload has to carry the versions published at
 * the time, not just the ticks.
 */
describe("buildLegalAcceptancePayload", () => {
  const now = { terms: "2026-10-16", privacy: "2026-10-16", contentPolicy: "2026-07-28" };

  it("records both acknowledgements with the version of each document published now", () => {
    expect(buildLegalAcceptancePayload(true, true, now)).toEqual({
      termsAccepted: true,
      contentResponsibilityAccepted: true,
      termsVersion: "2026-10-16",
      privacyVersion: "2026-10-16",
      contentPolicyVersion: "2026-07-28",
    });
  });

  it("never reports an acceptance that was not given", () => {
    const payload = buildLegalAcceptancePayload(false, "yes" as never, now);
    expect(payload.termsAccepted).toBe(false);
    expect(payload.contentResponsibilityAccepted).toBe(false);
  });

  it("every document has a title and an address", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.url).toBe(`/legal/${doc.id}`);
    }
  });
});
