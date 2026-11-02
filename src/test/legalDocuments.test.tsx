import { describe, expect, it } from "vitest";
import { buildLegalAcceptancePayload } from "../lib/legal/documents";
import { parseLegalMarkup } from "../lib/legal/markup";

describe("legal documents in the store", () => {
  it("record the versions published now with both acknowledgements", () => {
    const now = { terms: "2026-10-16", privacy: "2026-10-16", contentPolicy: "2026-07-28" };
    expect(buildLegalAcceptancePayload(true, true, now)).toEqual({
      termsAccepted: true,
      contentResponsibilityAccepted: true,
      termsVersion: "2026-10-16",
      privacyVersion: "2026-10-16",
      contentPolicyVersion: "2026-07-28",
    });
    expect(buildLegalAcceptancePayload(false, "yes" as never, now).contentResponsibilityAccepted).toBe(false);
  });

  it("read the server's text format the same way the server does", () => {
    const parsed = parseLegalMarkup("Intro.\n\n## 1. One\nText.\n- a\n- b");
    expect(parsed.intro).toEqual([{ type: "p", text: "Intro." }]);
    expect(parsed.sections[0]).toEqual({ heading: "1. One", blocks: [{ type: "p", text: "Text." }, { type: "ul", items: ["a", "b"] }] });
  });
});
