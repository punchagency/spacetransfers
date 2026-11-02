import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildLegalAcceptancePayload, readingProgress } from "../lib/legal/documents";
import LegalAcceptance from "../components/modals/LegalAcceptance";

vi.mock("../lib/utils/api", () => ({ apiFetch: vi.fn(async () => ({ documents: [] })) }));
import { parseLegalMarkup } from "../lib/legal/markup";

describe("legal documents in the store", () => {
  it("record the versions published now with both acknowledgements and when each was read", () => {
    const now = { terms: "2026-10-16", privacy: "2026-10-16", contentPolicy: "2026-07-28" };
    const read = { terms: "2026-10-29T10:00:00.000Z", privacy: "2026-10-29T10:01:00.000Z", contentPolicy: "2026-10-29T10:02:00.000Z" };
    expect(buildLegalAcceptancePayload(true, true, now, read)).toEqual({
      termsAccepted: true,
      contentResponsibilityAccepted: true,
      termsVersion: "2026-10-16",
      privacyVersion: "2026-10-16",
      contentPolicyVersion: "2026-07-28",
      readAt: read,
    });
    expect(buildLegalAcceptancePayload(false, "yes" as never, now, read).contentResponsibilityAccepted).toBe(false);
  });

  it("count a document as read only at its end", () => {
    expect(readingProgress({ scrollTop: 0, clientHeight: 400, scrollHeight: 2000 })).toEqual({ atEnd: false, fraction: 0.2 });
    expect(readingProgress({ scrollTop: 1590, clientHeight: 400, scrollHeight: 2000 }).atEnd).toBe(true);
    expect(readingProgress({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 }).atEnd).toBe(true);
  });

  it("read the server's text format the same way the server does", () => {
    const parsed = parseLegalMarkup("Intro.\n\n## 1. One\nText.\n- a\n- b");
    expect(parsed.intro).toEqual([{ type: "p", text: "Intro." }]);
    expect(parsed.sections[0]).toEqual({ heading: "1. One", blocks: [{ type: "p", text: "Text." }, { type: "ul", items: ["a", "b"] }] });
  });
});

describe("the sign-up agreements", () => {
  const props = (readAt = {}) => ({
    termsAccepted: false,
    contentResponsibilityAccepted: false,
    onTermsChange: vi.fn(),
    onContentResponsibilityChange: vi.fn(),
    showErrors: false,
    onOpenDocument: vi.fn(),
    readAt,
  });

  it("open the first unread document instead of ticking", () => {
    const p = props({ terms: "2026-10-29T10:00:00.000Z" });
    render(<LegalAcceptance {...p} />);
    fireEvent.click(screen.getByLabelText(/I have read and agree/));
    expect(p.onOpenDocument).toHaveBeenCalledWith("privacy");
    expect(p.onTermsChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Privacy Policy still to read/)).toBeInTheDocument();
  });

  it("tick once every document a box covers was read to the end", () => {
    const p = props({ terms: "2026-10-29T10:00:00.000Z", privacy: "2026-10-29T10:01:00.000Z", contentPolicy: "2026-10-29T10:02:00.000Z" });
    render(<LegalAcceptance {...p} />);
    fireEvent.click(screen.getByLabelText(/I have read and agree/));
    fireEvent.click(screen.getByLabelText(/I own or have permission/));
    expect(p.onTermsChange).toHaveBeenCalledWith(true);
    expect(p.onContentResponsibilityChange).toHaveBeenCalledWith(true);
    expect(p.onOpenDocument).not.toHaveBeenCalled();
  });
});
