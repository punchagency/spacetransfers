import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SLA_REASON_PREFIX,
  enteredStatusAt,
  evaluateSla,
  hoursForStage,
  resolveBreachAction,
  slaAction,
  slaReassignmentCount,
} from "../utils/slaStages.js";
import { DEFAULT_SLA_SETTINGS, normalizeSlaSettings } from "../services/partnerCapacity.service.js";

/**
 * There has been an SLA in this codebase all along — a flat 24 hours, computed
 * at assignment, stored on the order and shown to the partner as a countdown.
 * Nothing ever read it back: a clock with no consequence, running at the same
 * speed for a rush job as for a normal one.
 *
 * These decide whether a business loses work it may already have started, so
 * the logic is pure and pinned here rather than discovered in production.
 */

const sla = normalizeSlaSettings({ enabled: true });
const HOUR = 3600_000;
const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h));

const order = (over: Record<string, unknown> = {}) => ({
  status: "PROCESSING",
  priority: "NORMAL",
  assignedAt: at(0),
  statusTimeline: [],
  assignmentHistory: [],
  ...over,
});

describe("stage windows", () => {
  it("gives a rush job less time, which is what the surcharge buys", () => {
    assert.equal(hoursForStage("ACCEPT", "NORMAL", sla), 24);
    assert.equal(hoursForStage("ACCEPT", "URGENT", sla), 4);
    assert.equal(hoursForStage("PRINT", "NORMAL", sla), 48);
    assert.equal(hoursForStage("PRINT", "URGENT", sla), 12);
  });

  it("treats anything that is not URGENT as normal", () => {
    for (const p of [undefined, null, "", "normal", "Normal", "rush"]) {
      assert.equal(hoursForStage("ACCEPT", p, sla), 24, String(p));
    }
  });
});

describe("a job on the press is never taken away automatically", () => {
  it("reassigns an unstarted job but only escalates one being printed", () => {
    assert.equal(slaAction("ACCEPT"), "REASSIGN");
    assert.equal(slaAction("PRINT"), "ESCALATE");
  });

  it("escalates an overdue PRINTING job rather than moving it", () => {
    const o = order({
      status: "PRINTING",
      statusTimeline: [{ status: "PRINTING", time: at(0) }],
    });
    const breach = evaluateSla(o, sla, at(49))!;
    assert.equal(breach.stage, "PRINT");
    assert.equal(breach.action, "ESCALATE");
    const resolved = resolveBreachAction(breach, 0, sla);
    assert.equal(resolved.action, "ESCALATE");
    assert.match(resolved.reason, /film loaded/);
  });
});

describe("evaluateSla", () => {
  it("is silent while the job is on time", () => {
    assert.equal(evaluateSla(order(), sla, at(23)), null);
  });

  it("breaches once the window passes", () => {
    const b = evaluateSla(order(), sla, at(25))!;
    assert.equal(b.stage, "ACCEPT");
    assert.equal(b.hoursAllowed, 24);
    assert.equal(b.overdueMs, HOUR);
  });

  it("breaches an urgent job far sooner", () => {
    assert.equal(evaluateSla(order({ priority: "URGENT" }), sla, at(3)), null);
    assert.ok(evaluateSla(order({ priority: "URGENT" }), sla, at(5)));
  });

  it("ignores statuses that are not a timed stage", () => {
    for (const status of ["PENDING", "QUALITY_CHECK", "SHIPPED", "COMPLETED", "CANCELLED"]) {
      assert.equal(evaluateSla(order({ status }), sla, at(999)), null, status);
    }
  });

  it("times PRINTING from when printing began, not from assignment", () => {
    // Assigned at 0, accepted late at 40, so the print window runs from 40.
    const o = order({
      status: "PRINTING",
      assignedAt: at(0),
      statusTimeline: [{ status: "PRINTING", time: at(40) }],
    });
    // 47h after assignment but only 7h on the press — well inside 48h.
    assert.equal(evaluateSla(o, sla, at(47)), null);
    assert.ok(evaluateSla(o, sla, at(89)), "overdue once 48h on the press have passed");
  });

  it("does nothing when there is no clock to read", () => {
    assert.equal(evaluateSla(order({ assignedAt: null }), sla, at(999)), null);
    assert.equal(evaluateSla(order({ status: "PRINTING", statusTimeline: [] }), sla, at(999)), null);
  });

  it("uses the most recent entry when a job re-enters a status", () => {
    const o = order({
      status: "PRINTING",
      statusTimeline: [
        { status: "PRINTING", time: at(0) },
        { status: "PENDING", time: at(5) },
        { status: "PRINTING", time: at(60) },
      ],
    });
    assert.equal(enteredStatusAt(o, "PRINTING")!.getTime(), at(60).getTime());
    assert.equal(evaluateSla(o, sla, at(100)), null, "the second run has not overrun yet");
  });
});

describe("a job cannot bounce around the network forever", () => {
  const history = (n: number) =>
    Array.from({ length: n }, () => ({ reason: `${SLA_REASON_PREFIX}: not started` }));

  it("counts only SLA moves, not ordinary assignment history", () => {
    assert.equal(slaReassignmentCount({ assignmentHistory: history(2) }), 2);
    assert.equal(
      slaReassignmentCount({ assignmentHistory: [{ reason: "Cancelled by printer Moho" }] }),
      0,
    );
    assert.equal(slaReassignmentCount({}), 0);
  });

  it("escalates instead of reassigning once the cap is reached", () => {
    const breach = evaluateSla(order(), sla, at(25))!;
    assert.equal(resolveBreachAction(breach, 0, sla).action, "REASSIGN");
    assert.equal(resolveBreachAction(breach, 1, sla).action, "REASSIGN");
    assert.equal(resolveBreachAction(breach, 2, sla).action, "ESCALATE");
    assert.match(resolveBreachAction(breach, 2, sla).reason, /needs a human/);
  });

  it("can be set to escalate only, never reassign", () => {
    const noMove = normalizeSlaSettings({ enabled: true, maxAutoReassignments: 0 });
    const breach = evaluateSla(order(), noMove, at(25))!;
    assert.equal(resolveBreachAction(breach, 0, noMove).action, "ESCALATE");
  });
});

describe("settings", () => {
  it("is off unless switched on — it moves live jobs between businesses", () => {
    assert.equal(DEFAULT_SLA_SETTINGS.enabled, false);
    assert.equal(normalizeSlaSettings({}).enabled, false);
    assert.equal(normalizeSlaSettings({ enabled: "yes" }).enabled, false);
    assert.equal(normalizeSlaSettings({ enabled: true }).enabled, true);
  });

  it("rejects nonsense windows rather than running on them", () => {
    const p = normalizeSlaSettings({ acceptHours: { normal: 0, urgent: -3 }, printHours: {} });
    assert.equal(p.acceptHours.normal, 24);
    assert.equal(p.acceptHours.urgent, 4);
    assert.equal(p.printHours.normal, 48);
  });

  it("keeps a deliberate zero cap, which disables moving without disabling alerts", () => {
    assert.equal(normalizeSlaSettings({ maxAutoReassignments: 0 }).maxAutoReassignments, 0);
    assert.equal(normalizeSlaSettings({ maxAutoReassignments: -1 }).maxAutoReassignments, 2);
  });
});

describe("changing a window does not take work off partners already holding it", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h));

  it("enforces the deadline stored at assignment, not a freshly computed one", () => {
    // Assigned under a 24h rule; the operator then tightens it to 4h.
    const tightened = normalizeSlaSettings({ enabled: true, acceptHours: { normal: 4, urgent: 4 } });
    const order = {
      status: "PROCESSING",
      priority: "NORMAL",
      assignedAt: at(0),
      assignmentDeadline: at(24),
      statusTimeline: [],
    };
    // 6h in: past the new rule, well inside what this partner was promised.
    assert.equal(evaluateSla(order, tightened, at(6)), null);
    // And it still breaches once the promised deadline actually passes.
    assert.ok(evaluateSla(order, tightened, at(25)));
  });

  it("uses the new window for anything assigned after the change", () => {
    const tightened = normalizeSlaSettings({ enabled: true, acceptHours: { normal: 4, urgent: 4 } });
    // No stored deadline — a fresh assignment computes from current settings.
    const fresh = { status: "PROCESSING", priority: "NORMAL", assignedAt: at(0), statusTimeline: [] };
    assert.ok(evaluateSla(fresh, tightened, at(5)), "the shorter window applies");
  });

  it("ignores an unreadable stored deadline rather than trusting it", () => {
    const order = {
      status: "PROCESSING",
      priority: "NORMAL",
      assignedAt: at(0),
      assignmentDeadline: new Date("not a date"),
      statusTimeline: [],
    };
    assert.ok(evaluateSla(order, sla, at(25)), "falls back to the configured window");
  });

  it("does not apply a stored assignment deadline to the printing stage", () => {
    // The stored value is the accept clock; PRINT must run from press-start.
    const order = {
      status: "PRINTING",
      priority: "NORMAL",
      assignedAt: at(0),
      assignmentDeadline: at(1),
      statusTimeline: [{ status: "PRINTING", time: at(0) }],
    };
    assert.equal(evaluateSla(order, sla, at(2)), null, "1h stored must not breach a 48h print window");
  });
});
