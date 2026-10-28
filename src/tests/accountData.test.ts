import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accountDeletionBlocker, OPEN_ORDER_STATUSES, partnerClosureBlocker } from "../services/accountData.service.js";
import { isLiveSession, SIGN_IN_BLOCKED_STATUSES } from "../utils/jwt.js";
import { storedKeyFor } from "../services/storage.service.js";

describe("closing a customer account", () => {
  it("is allowed once nothing is in progress", () => {
    assert.equal(accountDeletionBlocker({ role: "CUSTOMER", subAccounts: 0, openOrders: 0 }), null);
  });

  it("waits for orders still being made or delivered", () => {
    assert.match(accountDeletionBlocker({ role: "CUSTOMER", subAccounts: 0, openOrders: 1 })!, /1 order still being made/);
    assert.match(accountDeletionBlocker({ role: "CUSTOMER", subAccounts: 0, openOrders: 2 })!, /once they arrive/);
    assert.deepEqual(OPEN_ORDER_STATUSES.includes("COMPLETED") || OPEN_ORDER_STATUSES.includes("CANCELLED"), false);
  });

  it("asks for linked accounts to go first, and is for customers only", () => {
    assert.match(accountDeletionBlocker({ role: "CUSTOMER", subAccounts: 1, openOrders: 0 })!, /linked accounts/);
    assert.match(accountDeletionBlocker({ role: "PRINTER", subAccounts: 0, openOrders: 0 })!, /Only customer accounts/);
  });

  it("waits for open problem reports to be resolved", () => {
    assert.match(accountDeletionBlocker({ role: "CUSTOMER", subAccounts: 0, openOrders: 0, openReports: 1 })!, /a problem report still open/);
    assert.match(accountDeletionBlocker({ role: "CUSTOMER", subAccounts: 0, openOrders: 0, openReports: 2 })!, /2 problem reports still open/);
  });

  it("leaves a linked account to its main account holder", () => {
    assert.match(accountDeletionBlocker({ role: "CUSTOMER", isSubAccount: true, subAccounts: 0, openOrders: 0 })!, /main account holder/);
  });

  it("removes only files we stored", () => {
    assert.equal(storedKeyFor("https://evil.example/space-transfers/x.png"), null);
    assert.equal(storedKeyFor(""), null);
  });
});

describe("closing a partner account", () => {
  const clear = { activeJobs: 0, openIssues: 0, owed: 0 };

  it("is allowed once there is no work, no open report and nothing owed", () => {
    assert.equal(partnerClosureBlocker(clear), null);
  });

  it("waits for jobs in progress first", () => {
    assert.match(partnerClosureBlocker({ ...clear, activeJobs: 1, owed: 20 })!, /1 job in progress\. Ship it/);
    assert.match(partnerClosureBlocker({ ...clear, activeJobs: 3 })!, /3 jobs in progress\. Ship them/);
  });

  it("waits for customer reports on their jobs", () => {
    assert.match(partnerClosureBlocker({ ...clear, openIssues: 1 })!, /1 customer report on your jobs is still open/);
    assert.match(partnerClosureBlocker({ ...clear, openIssues: 2 })!, /2 customer reports on your jobs are still open/);
  });

  it("waits until the partner has been paid", () => {
    assert.match(partnerClosureBlocker({ ...clear, owed: 42.5 })!, /still owed \$42\.50/);
  });

  it("ends every session of a closed account", () => {
    assert.ok(SIGN_IN_BLOCKED_STATUSES.includes("Closed"));
    assert.equal(isLiveSession({ sub: "p1", role: "PRINTER", tv: 0 }, { tokenVersion: 0, status: "Closed" }), false);
  });
});
