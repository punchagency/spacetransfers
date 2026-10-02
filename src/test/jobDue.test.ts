import { describe, expect, it } from "vitest";
import { jobDue } from "../utils/jobDue";

const NOW = Date.parse("2026-09-30T12:00:00Z");

describe("what a job is due for next", () => {
  it("is accept-by before the job is started", () => {
    const due = jobDue("2026-10-01T12:00:00Z", "ACCEPT", NOW - 1);
    expect(due.label).toBe("Accept by");
    expect(due.overdue).toBe(false);
    expect(due.soon).toBe(false);
  });

  it("is print-by while printing, flagged when under a day away", () => {
    const due = jobDue("2026-09-30T18:00:00Z", "PRINT", NOW);
    expect(due.label).toBe("Print by");
    expect(due.soon).toBe(true);
  });

  it("is overdue once the time has passed", () => {
    const due = jobDue("2026-09-30T11:00:00Z", "ACCEPT", NOW);
    expect(due.overdue).toBe(true);
    expect(due.soon).toBe(false);
  });

  it("is nothing once the label is requested, or with a bad date", () => {
    expect(jobDue(null, null, NOW).at).toBeNull();
    expect(jobDue("2026-10-01T12:00:00Z", null, NOW).at).toBeNull();
    expect(jobDue("not a date", "ACCEPT", NOW).at).toBeNull();
  });
});
