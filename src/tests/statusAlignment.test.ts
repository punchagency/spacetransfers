import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeTimelineMessage, statusChangeMessage } from "../utils/orderStatusLabels.js";
import { stageDue } from "../utils/slaStages.js";

const SLA = {
  enabled: false,
  acceptHours: { normal: 24, urgent: 2 },
  printHours: { normal: 48, urgent: 6 },
  maxAutoReassignments: 2,
} as any;

describe("status wording is the same in every app", () => {
  it("describes a partner's move in plain words, never the database code", () => {
    assert.equal(statusChangeMessage("PRINTER", "QUALITY_CHECK"), "Partner finished printing and requested the shipping label");
    assert.equal(statusChangeMessage("PRINTER", "PRINTING"), "Partner started printing");
    assert.equal(statusChangeMessage("ADMIN", "QUALITY_CHECK"), "Admin set the status to Ready to Ship");
  });

  it("rewrites the raw sentences already stored on orders", () => {
    assert.equal(
      describeTimelineMessage("Printer updated status to QUALITY_CHECK"),
      "Partner finished printing and requested the shipping label",
    );
    assert.equal(describeTimelineMessage("Admin updated status to PRINTING"), "Admin set the status to Printing");
    assert.equal(describeTimelineMessage("Order assigned to Claude Demo Print Co"), "Order assigned to Claude Demo Print Co");
    assert.equal(describeTimelineMessage(undefined), null);
  });
});

describe("what a partner is due to do next", () => {
  const assignedAt = new Date("2026-09-30T10:00:00Z");

  it("is accept-by before the job is started", () => {
    const due = stageDue({ status: "PROCESSING", priority: "NORMAL", assignedAt }, SLA);
    assert.equal(due?.stage, "ACCEPT");
    assert.equal(due?.dueAt.toISOString(), "2026-10-01T10:00:00.000Z");
  });

  it("is print-by once printing, counted from when printing began", () => {
    const due = stageDue(
      {
        status: "PRINTING",
        priority: "URGENT",
        assignedAt,
        statusTimeline: [{ status: "PRINTING", time: "2026-09-30T12:00:00Z" }],
      },
      SLA,
    );
    assert.equal(due?.stage, "PRINT");
    assert.equal(due?.dueAt.toISOString(), "2026-09-30T18:00:00.000Z");
  });

  it("is nothing once the label is requested, shipped, completed or cancelled", () => {
    for (const status of ["QUALITY_CHECK", "SHIPPED", "COMPLETED", "CANCELLED"]) {
      assert.equal(stageDue({ status, assignedAt }, SLA), null, status);
    }
  });
});
