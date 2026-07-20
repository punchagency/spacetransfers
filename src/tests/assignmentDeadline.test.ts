/**
 * Assignment-deadline tests — the 24h fulfilment SLA.
 * Run with: npm test
 * Uses Node.js built-in test runner (node:test), no database required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ASSIGNMENT_SLA_MS,
  computeAssignmentDeadline,
  resolveOrderDeadlineIso,
} from "../utils/assignmentDeadline.js";

describe("Assignment deadline (24h SLA)", () => {
  it("the SLA window is exactly 24 hours", () => {
    assert.equal(ASSIGNMENT_SLA_MS, 24 * 60 * 60 * 1000);
  });

  it("computeAssignmentDeadline is assignedAt + 24h to the millisecond", () => {
    const assignedAt = new Date("2026-07-16T10:00:00.000Z");
    const deadline = computeAssignmentDeadline(assignedAt);
    assert.equal(deadline.toISOString(), "2026-07-17T10:00:00.000Z");
    assert.equal(deadline.getTime() - assignedAt.getTime(), ASSIGNMENT_SLA_MS);
  });

  it("prefers the stored assignmentDeadline when present", () => {
    const iso = resolveOrderDeadlineIso({
      assignmentDeadline: new Date("2026-07-17T10:00:00.000Z"),
      assignedAt: new Date("2026-07-16T09:00:00.000Z"),
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    assert.equal(iso, "2026-07-17T10:00:00.000Z");
  });

  it("falls back to assignedAt + 24h when there is no stored deadline", () => {
    const iso = resolveOrderDeadlineIso({
      assignedAt: new Date("2026-07-16T10:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.equal(iso, "2026-07-17T10:00:00.000Z");
  });

  it("falls back to createdAt + 24h for legacy orders with no assignment stamps", () => {
    const iso = resolveOrderDeadlineIso({
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
    });
    assert.equal(iso, "2026-07-17T00:00:00.000Z");
  });

  it("returns null when there is no basis for a deadline", () => {
    assert.equal(resolveOrderDeadlineIso({}), null);
  });

  it("ignores unparseable dates and falls through", () => {
    const iso = resolveOrderDeadlineIso({
      assignmentDeadline: "not-a-date" as any,
      assignedAt: new Date("2026-07-16T10:00:00.000Z"),
    });
    assert.equal(iso, "2026-07-17T10:00:00.000Z");
  });
});
