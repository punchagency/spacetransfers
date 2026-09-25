import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime, getDeadlineStatus } from "../utils/datetime";

/**
 * A print partner reads these on the job list to decide what to run next, so
 * "overdue" and "due soon" have to be right at the boundaries, not just in the
 * middle of the range.
 */
const NOW = new Date("2026-03-05T12:00:00.000Z").getTime();
const hours = (n: number) => new Date(NOW + n * 3600_000).toISOString();

describe("getDeadlineStatus", () => {
  it("counts down while there is time left", () => {
    const s = getDeadlineStatus(hours(26), NOW);
    expect(s.overdue).toBe(false);
    expect(s.dueSoon).toBe(false);
    expect(s.label).toBe("1d 2h left");
  });

  it("flags the last four hours as due soon", () => {
    expect(getDeadlineStatus(hours(3.5), NOW).dueSoon).toBe(true);
    expect(getDeadlineStatus(hours(4.5), NOW).dueSoon).toBe(false);
  });

  it("treats exactly four hours as due soon, and exactly now as overdue", () => {
    // The boundaries are where a wrong comparison hides.
    expect(getDeadlineStatus(hours(4), NOW).dueSoon).toBe(true);
    const due = getDeadlineStatus(new Date(NOW).toISOString(), NOW);
    expect(due.overdue).toBe(true);
    expect(due.dueSoon).toBe(false);
  });

  it("says how late an overdue job is", () => {
    const s = getDeadlineStatus(hours(-2.5), NOW);
    expect(s.overdue).toBe(true);
    expect(s.label).toBe("Overdue by 2h 30m");
    expect(s.msLeft).toBeLessThan(0);
  });

  it("reports minutes when that is all that is left", () => {
    expect(getDeadlineStatus(hours(0.75), NOW).label).toBe("45m left");
  });

  /* A job with no deadline must not read as overdue — that would send someone
     chasing a job that was never late. */
  it("has nothing to say about a missing or unreadable deadline", () => {
    for (const value of [null, undefined, "", "not a date"]) {
      const s = getDeadlineStatus(value as never, NOW);
      expect(s.overdue).toBe(false);
      expect(s.dueSoon).toBe(false);
      expect(s.deadlineMs).toBeNull();
      expect(s.label).toBe("—");
      expect(s.absolute).toBe("—");
    }
  });
});

describe("formatting", () => {
  it("formats a real date, and refuses to invent one", () => {
    expect(formatDateTime("2026-03-05T12:00:00.000Z")).not.toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatTime(null as never)).toBe("—");
  });
});
