import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Switching "Maximum Jobs Per Partner" off must not forget the number.
 *
 * It used to: the PATCH wrote `maxJobsValue: null` whenever the limit was off,
 * and the GET reported the built-in 10 in its place. An operator who toggled
 * the limit off and on again came back to 10 rather than the 25 they had set —
 * silently changing every partner's capacity. These pin both halves of the
 * round trip, mirroring `updatePartnerAssignmentSettings` and
 * `getPartnerAssignmentSettings` in admin.controller.ts.
 */

/** What the PATCH stores, given what is already stored and what was sent. */
const storedValue = (
  existing: { maxJobsValue?: number | null },
  body: { maxJobsEnabled?: boolean; maxJobsValue?: unknown },
): { maxJobsEnabled: boolean; maxJobsValue: number | null } => {
  const enabled = body.maxJobsEnabled !== false;
  const previous = Number(existing?.maxJobsValue);
  const kept = Number.isFinite(previous) && previous > 0 ? Math.floor(previous) : null;
  const parsed = parseInt(String(body.maxJobsValue), 10);
  if (enabled && (!Number.isFinite(parsed) || parsed < 1)) throw new Error("400");
  return { maxJobsEnabled: enabled, maxJobsValue: enabled ? parsed : kept };
};

/** What the GET reports for the console's field. */
const reportedValue = (stored: { maxJobsValue?: number | null }): number =>
  Number(stored?.maxJobsValue) > 0 ? Math.floor(Number(stored.maxJobsValue)) : 10;

describe("maximum jobs per partner", () => {
  it("keeps the configured number when the limit is switched off", () => {
    const afterOff = storedValue({ maxJobsValue: 25 }, { maxJobsEnabled: false });
    assert.equal(afterOff.maxJobsEnabled, false);
    assert.equal(afterOff.maxJobsValue, 25);
  });

  it("gives that number back when the limit is switched on again", () => {
    const off = storedValue({ maxJobsValue: 25 }, { maxJobsEnabled: false });
    // The console re-opens the settings and sees 25, not 10.
    assert.equal(reportedValue(off), 25);
  });

  it("stores a new number when one is set", () => {
    assert.equal(storedValue({ maxJobsValue: 25 }, { maxJobsEnabled: true, maxJobsValue: "8" }).maxJobsValue, 8);
  });

  it("reports 10 only when a limit has never been set", () => {
    assert.equal(reportedValue({}), 10);
    assert.equal(reportedValue({ maxJobsValue: null }), 10);
  });

  it("refuses a limit that is on but not a number, rather than storing NaN", () => {
    // Math.max(1, NaN) is NaN — it would have been stored and quietly disabled
    // every capacity check.
    assert.throws(() => storedValue({}, { maxJobsEnabled: true, maxJobsValue: "" }), /400/);
    assert.throws(() => storedValue({}, { maxJobsEnabled: true, maxJobsValue: "abc" }), /400/);
    assert.throws(() => storedValue({}, { maxJobsEnabled: true, maxJobsValue: 0 }), /400/);
  });

  it("switching off with nothing ever configured stays empty", () => {
    assert.equal(storedValue({}, { maxJobsEnabled: false }).maxJobsValue, null);
  });
});
