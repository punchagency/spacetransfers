import { describe, expect, it } from "vitest";
import { awaitingPartnerReply, jobIssueTag, readJobIssueFlag } from "../utils/jobIssues";

const m = (author: "ADMIN" | "PARTNER") => ({ id: author, author, authorName: "", body: "x", at: "2026-10-12T10:00:00Z" });

describe("a question from the admin about a job", () => {
  it("waits on the partner only while the admin spoke last and it is open", () => {
    expect(awaitingPartnerReply({ status: "OPEN", messages: [m("ADMIN")] })).toBe(true);
    expect(awaitingPartnerReply({ status: "OPEN", messages: [m("ADMIN"), m("PARTNER")] })).toBe(false);
    expect(awaitingPartnerReply({ status: "RESOLVED", messages: [m("ADMIN")] })).toBe(false);
    expect(awaitingPartnerReply({ status: "OPEN", messages: [] })).toBe(false);
  });

  it("tags a job red while it waits on the partner, amber after, and not at all without a question", () => {
    expect(jobIssueTag(readJobIssueFlag({ open: true, awaitingReply: true }))).toEqual({ label: "Reply needed", tone: "red" });
    expect(jobIssueTag(readJobIssueFlag({ open: true, awaitingReply: false }))).toEqual({ label: "Problem reported", tone: "amber" });
    expect(jobIssueTag(readJobIssueFlag(null))).toBeNull();
    expect(jobIssueTag(readJobIssueFlag(undefined))).toBeNull();
  });
});
