/**
 * Partner capacity + assignment-mode tests — pure decision logic.
 * Run with: npm test
 * Uses Node.js built-in test runner (node:test), no database required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getEffectiveMaxConcurrent,
  decideCapacityTransition,
  isAtCapacity,
  DEFAULT_SLA_SETTINGS,
  type PartnerAssignmentSettings,
} from "../services/partnerCapacity.service.js";

const settings = (over: Partial<PartnerAssignmentSettings> = {}): PartnerAssignmentSettings => ({
  rule: "nearest-region",
  maxJobsEnabled: true,
  maxJobsValue: 10,
  sla: DEFAULT_SLA_SETTINGS,
  ...over,
});

// ── getEffectiveMaxConcurrent ─────────────────────────────────────────────────

describe("getEffectiveMaxConcurrent", () => {
  it("uses the global limit when no per-partner override is set", () => {
    assert.equal(getEffectiveMaxConcurrent({}, settings({ maxJobsValue: 5 })), 5);
  });

  it("uses the per-partner override when the global limit is disabled", () => {
    const partner = { settings: { jobCapacity: { maxConcurrent: 3 } } };
    assert.equal(
      getEffectiveMaxConcurrent(partner, settings({ maxJobsEnabled: false, maxJobsValue: null })),
      3,
    );
  });

  it("takes the most restrictive of global and per-partner limits", () => {
    const partner = { settings: { jobCapacity: { maxConcurrent: 8 } } };
    assert.equal(getEffectiveMaxConcurrent(partner, settings({ maxJobsValue: 4 })), 4);
    const partner2 = { settings: { jobCapacity: { maxConcurrent: 2 } } };
    assert.equal(getEffectiveMaxConcurrent(partner2, settings({ maxJobsValue: 6 })), 2);
  });

  it("returns null when no limit applies (global off, no override)", () => {
    assert.equal(
      getEffectiveMaxConcurrent({}, settings({ maxJobsEnabled: false, maxJobsValue: null })),
      null,
    );
  });

  it("ignores zero / invalid per-partner values", () => {
    const partner = { settings: { jobCapacity: { maxConcurrent: 0 } } };
    assert.equal(getEffectiveMaxConcurrent(partner, settings({ maxJobsValue: 7 })), 7);
  });
});

// ── isAtCapacity (shared auto + manual eligibility rule) ──────────────────────

describe("isAtCapacity — shared eligibility rule for auto & manual assignment", () => {
  it("is full at the limit (limit 1, one active job → blocked)", () => {
    assert.equal(isAtCapacity(1, 1), true);
  });

  it("is full above the limit", () => {
    assert.equal(isAtCapacity(3, 2), true);
  });

  it("is not full below the limit", () => {
    assert.equal(isAtCapacity(0, 1), false);
    assert.equal(isAtCapacity(9, 10), false);
  });

  it("is never full when there is no limit", () => {
    assert.equal(isAtCapacity(1000, null), false);
  });
});

// ── decideCapacityTransition — auto-pause ─────────────────────────────────────

describe("decideCapacityTransition — auto-pause at max", () => {
  it("pauses an Open partner who has reached the limit", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "open",
      capacityPaused: false,
      activeJobs: 10,
      maxJobs: 10,
    });
    assert.equal(d.transition, "paused");
    assert.equal(d.availabilityStatus, "paused");
    assert.equal(d.capacityPaused, true);
  });

  it("pauses when active jobs exceed the limit", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "open",
      capacityPaused: false,
      activeJobs: 12,
      maxJobs: 10,
    });
    assert.equal(d.transition, "paused");
  });

  it("does not pause when below the limit", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "open",
      capacityPaused: false,
      activeJobs: 9,
      maxJobs: 10,
    });
    assert.equal(d.transition, null);
    assert.equal(d.availabilityStatus, "open");
  });

  it("never pauses when there is no limit", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "open",
      capacityPaused: false,
      activeJobs: 999,
      maxJobs: null,
    });
    assert.equal(d.transition, null);
  });
});

// ── decideCapacityTransition — auto-recover ───────────────────────────────────

describe("decideCapacityTransition — auto-recover below max", () => {
  it("reopens a capacity-paused partner once load drops below the limit", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "paused",
      capacityPaused: true,
      activeJobs: 9,
      maxJobs: 10,
    });
    assert.equal(d.transition, "reopened");
    assert.equal(d.availabilityStatus, "open");
    assert.equal(d.capacityPaused, false);
  });

  it("does NOT reopen a manually-paused partner (capacityPaused = false)", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "paused",
      capacityPaused: false,
      activeJobs: 0,
      maxJobs: 10,
    });
    assert.equal(d.transition, null);
    assert.equal(d.availabilityStatus, "paused");
  });

  it("keeps a capacity-paused partner paused while still at the limit", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "paused",
      capacityPaused: true,
      activeJobs: 10,
      maxJobs: 10,
    });
    assert.equal(d.transition, null);
    assert.equal(d.availabilityStatus, "paused");
  });

  it("clears a stale capacity flag without reopening when no longer paused", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "stopped",
      capacityPaused: true,
      activeJobs: 1,
      maxJobs: 10,
    });
    assert.equal(d.transition, "clear_flag");
    assert.equal(d.availabilityStatus, "stopped");
    assert.equal(d.capacityPaused, false);
  });

  it("never touches a 'stopped' partner who is below the limit and not capacity-paused", () => {
    const d = decideCapacityTransition({
      availabilityStatus: "stopped",
      capacityPaused: false,
      activeJobs: 0,
      maxJobs: 10,
    });
    assert.equal(d.transition, null);
    assert.equal(d.availabilityStatus, "stopped");
  });
});

// ── round-trip: pause then recover ────────────────────────────────────────────

describe("decideCapacityTransition — pause/recover round trip", () => {
  it("an Open partner pauses at max and reopens when a job completes", () => {
    const paused = decideCapacityTransition({
      availabilityStatus: "open",
      capacityPaused: false,
      activeJobs: 5,
      maxJobs: 5,
    });
    assert.equal(paused.transition, "paused");

    // A job completes → active drops to 4, feed the new state back in.
    const reopened = decideCapacityTransition({
      availabilityStatus: paused.availabilityStatus,
      capacityPaused: paused.capacityPaused,
      activeJobs: 4,
      maxJobs: 5,
    });
    assert.equal(reopened.transition, "reopened");
    assert.equal(reopened.availabilityStatus, "open");
  });
});
