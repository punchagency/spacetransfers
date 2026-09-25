import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS, buildLegalAcceptancePayload } from "../utils/legal";

/**
 * What a print partner accepted, and which wording they accepted, is recorded
 * with their account — so the payload has to carry the versions, not just the
 * ticks.
 */
describe("buildLegalAcceptancePayload", () => {
  it("records both acknowledgements with the version of each document", () => {
    const payload = buildLegalAcceptancePayload(true, true);
    expect(payload).toEqual({
      termsAccepted: true,
      contentResponsibilityAccepted: true,
      termsVersion: LEGAL_DOCUMENTS.terms.version,
      privacyVersion: LEGAL_DOCUMENTS.privacy.version,
      contentPolicyVersion: LEGAL_DOCUMENTS.contentPolicy.version,
    });
  });

  it("never reports an acceptance that was not given", () => {
    // Anything other than a real `true` is a refusal: a truthy string from a
    // form must not be recorded as consent.
    const payload = buildLegalAcceptancePayload(false, "yes" as never);
    expect(payload.termsAccepted).toBe(false);
    expect(payload.contentResponsibilityAccepted).toBe(false);
  });

  it("every document has a version and a title to show", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      expect(doc.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.title.length).toBeGreaterThan(0);
    }
  });
});
