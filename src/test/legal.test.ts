import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS, buildLegalAcceptancePayload, legalKeyOf, readingProgress } from "../utils/legal";

/**
 * What a print partner accepted, and which wording they accepted, is recorded
 * with their account — so the payload has to carry the versions published at
 * the time, not just the ticks.
 */
describe("buildLegalAcceptancePayload", () => {
  const now = { terms: "2026-10-16", privacy: "2026-10-16", contentPolicy: "2026-07-28" };
  const read = { terms: "2026-10-29T10:00:00.000Z", privacy: "2026-10-29T10:01:00.000Z", contentPolicy: "2026-10-29T10:02:00.000Z" };

  it("records both acknowledgements with the version of each document published now", () => {
    expect(buildLegalAcceptancePayload(true, true, now, read)).toEqual({
      termsAccepted: true,
      contentResponsibilityAccepted: true,
      termsVersion: "2026-10-16",
      privacyVersion: "2026-10-16",
      contentPolicyVersion: "2026-07-28",
      readAt: read,
    });
  });

  it("never reports an acceptance that was not given", () => {
    const payload = buildLegalAcceptancePayload(false, "yes" as never, now, read);
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

describe("reading before agreeing", () => {
  it("counts a document as read only at its end, or at once when it fits", () => {
    expect(readingProgress({ scrollTop: 0, clientHeight: 400, scrollHeight: 2000 })).toEqual({ atEnd: false, fraction: 0.2 });
    expect(readingProgress({ scrollTop: 1590, clientHeight: 400, scrollHeight: 2000 }).atEnd).toBe(true);
    expect(readingProgress({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 }).atEnd).toBe(true);
  });

  it("knows which document an id names", () => {
    expect(legalKeyOf("content-policy")).toBe("contentPolicy");
    expect(legalKeyOf("nope")).toBeNull();
  });
});
