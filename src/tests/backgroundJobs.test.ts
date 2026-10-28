/**
 * The background jobs' own decisions: when the weekly payout drafts and the
 * nightly backup are due (including after a server slept through their time),
 * which admin email batches are tried again, and what the export cleanup keeps.
 * Run with: npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isPayoutDraftDue } from "../services/payoutScheduler.service.js";
import { backupMissedToday } from "../services/backup.service.js";
import { removeOldExports } from "../services/exportCleanup.service.js";
import { dueEmailBatchesFilter } from "../services/adminNotifications.service.js";

describe("weekly payout drafts", () => {
  const friday = (hhmm: string) => new Date(`2026-10-30T${hhmm}:00Z`);

  it("run once on Friday from 09:00 UTC, including later that day for a server that slept through 09:00", () => {
    assert.equal(isPayoutDraftDue(friday("08:59"), null), false);
    assert.equal(isPayoutDraftDue(friday("09:00"), null), true);
    assert.equal(isPayoutDraftDue(friday("17:42"), null), true);
    assert.equal(isPayoutDraftDue(friday("17:42"), "2026-10-30"), false, "not twice in one day");
  });

  it("don't run on other days", () => {
    assert.equal(isPayoutDraftDue(new Date("2026-10-29T09:00:00Z"), null), false);
    assert.equal(isPayoutDraftDue(new Date("2026-10-31T09:00:00Z"), null), false);
  });
});

describe("nightly backup catch-up", () => {
  it("makes today's backup on start-up when 03:00 UTC has passed without one", () => {
    assert.equal(backupMissedToday(new Date("2026-10-28T10:00:00Z"), "2026-10-27"), true);
    assert.equal(backupMissedToday(new Date("2026-10-28T10:00:00Z"), undefined), true);
  });

  it("leaves it to the 03:00 run otherwise", () => {
    assert.equal(backupMissedToday(new Date("2026-10-28T10:00:00Z"), "2026-10-28"), false);
    assert.equal(backupMissedToday(new Date("2026-10-28T02:30:00Z"), "2026-10-27"), false);
  });
});

describe("admin email retries", () => {
  it("picks up due batches, failed ones after a pause and up to three attempts, and ones stuck sending, from the last day only", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const [pending, failed, sending] = (dueEmailBatchesFilter(now) as any).$or;
    assert.deepEqual(pending, { status: "pending", dueAt: { $lte: now } });
    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.attempts, { $lt: 3 });
    assert.equal(failed.lastAttemptAt.$lte.toISOString(), "2026-10-28T11:55:00.000Z");
    assert.equal(sending.status, "sending");
    assert.equal(sending.lastAttemptAt.$lte.toISOString(), "2026-10-28T11:50:00.000Z");
    // A batch from last week stays failed rather than arriving as stale news.
    assert.equal(failed.dueAt.$gte.toISOString(), "2026-10-27T12:00:00.000Z");
    assert.equal(sending.dueAt.$gte.toISOString(), "2026-10-27T12:00:00.000Z");
  });
});

describe("export cleanup", () => {
  it("removes old exports and long-empty folders, keeps recent ones and folders an export may be writing into", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "exports-"));
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);
    const write = async (rel: string, age: number) => {
      const file = path.join(root, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "x".repeat(10));
      await fs.utimes(file, daysAgo(age), daysAgo(age));
    };
    await write("printers/p1/job-old/sheet.zip", 20);
    await write("printers/p1/job-new/sheet.zip", 2);
    await write("printers/order-preview/job-old/preview.webp", 30);
    // Made just now by an export that is still rendering: empty, but must stay.
    await fs.mkdir(path.join(root, "printers/p1/job-rendering"), { recursive: true });
    // Emptied long ago.
    await fs.mkdir(path.join(root, "printers/p2/job-gone"), { recursive: true });
    await fs.utimes(path.join(root, "printers/p2/job-gone"), daysAgo(3), daysAgo(3));

    const result = await removeOldExports(root, 14, now);
    const exists = (rel: string) => fs.stat(path.join(root, rel)).then(() => true, () => false);

    assert.deepEqual(result, { files: 2, bytes: 20 });
    assert.equal(await exists("printers/p1/job-new/sheet.zip"), true);
    assert.equal(await exists("printers/p1/job-rendering"), true);
    assert.equal(await exists("printers/p2/job-gone"), false);
    assert.equal(await exists("printers/p1/job-old/sheet.zip"), false);
    assert.equal(await exists("printers/order-preview/job-old/preview.webp"), false);
    assert.equal(await exists(""), true, "never the exports folder itself");
    await fs.rm(root, { recursive: true, force: true });
  });
});
