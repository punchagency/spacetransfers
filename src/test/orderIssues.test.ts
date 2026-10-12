import { describe, expect, it } from "vitest";
import { canReportIssue, issueButton, issuePhotoThumb, pickIssuePhotos, reportFormError, resolutionSummary } from "../lib/utils/orderIssues";

describe("reporting a problem with an order", () => {
  it("needs a choice, and words only for Other", () => {
    expect(reportFormError(null, "")).toMatch(/Choose/);
    expect(reportFormError("DAMAGED", "")).toBeNull();
    expect(reportFormError("OTHER", "  ")).toMatch(/what went wrong/);
    expect(reportFormError("OTHER", "Wrong colours")).toBeNull();
    expect(reportFormError("DAMAGED", "x".repeat(2001))).toMatch(/under 2000/);
  });

  it("is not offered on a cancelled order", () => {
    expect(canReportIssue("Cancelled")).toBe(false);
    for (const s of ["Pending", "Processing", "Shipped", "Completed"]) expect(canReportIssue(s)).toBe(true);
  });

  it("labels the button by where the report stands", () => {
    expect(issueButton(null)).toEqual({ label: "Report a problem", tone: "plain" });
    expect(issueButton({ status: "OPEN", unread: false })).toEqual({ label: "View report", tone: "open" });
    expect(issueButton({ status: "OPEN", unread: true })).toEqual({ label: "New reply", tone: "reply" });
    expect(issueButton({ status: "RESOLVED", unread: true })).toEqual({ label: "New reply", tone: "reply" });
    expect(issueButton({ status: "RESOLVED", unread: false })).toEqual({ label: "Report a problem", tone: "plain" });
  });

  it("says how a report ended", () => {
    const base = { outcomeLabel: "", note: "", at: "", refundAmount: null, reprintDisplayId: null };
    expect(resolutionSummary({ ...base, outcome: "REFUND", refundAmount: 5 })).toBe("We refunded $5.00 to your card.");
    expect(resolutionSummary({ ...base, outcome: "REPRINT", reprintDisplayId: "DTF-0301" })).toMatch(/free of charge as DTF-0301/);
    expect(resolutionSummary({ ...base, outcome: "NONE" })).toBe("This report was closed.");
  });

  it("takes JPG and PNG photos up to the limit and says why others were left out", () => {
    const jpg = (name: string, size = 1000) => ({ name, type: "image/jpeg", size });
    expect(pickIssuePhotos([jpg("a.jpg"), jpg("b.jpg")], 0)).toEqual({ accepted: [0, 1], problems: [] });
    const mixed = pickIssuePhotos([{ name: "doc.pdf", type: "application/pdf", size: 10 }, jpg("big.jpg", 20 * 1024 * 1024), jpg("ok.jpg")], 0);
    expect(mixed.accepted).toEqual([2]);
    expect(mixed.problems).toEqual(["doc.pdf isn't a JPG or PNG photo.", "big.jpg is over 15 MB."]);
    const full = pickIssuePhotos([jpg("a.jpg"), jpg("b.jpg"), jpg("c.jpg")], 3);
    expect(full.accepted).toEqual([0]);
    expect(full.problems).toEqual(["You can add up to 4 photos."]);
  });

  it("finds the small version of a stored photo", () => {
    expect(issuePhotoThumb("https://files.example.com/issues/u1/1-abc.jpg")).toBe("https://files.example.com/issues/u1/1-abc-thumb200.webp");
  });
});
