/**
 * Paying a partner: one transfer per payout, ever, however many times the bank
 * step is tried. A retry used to repeat the transfer, paying the partner again.
 * Run with: npm test — Stripe is replaced by recorded fakes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bankPayoutChange, deliverPayout, type DeliverySteps, type PayoutRecord } from "../services/payoutDelivery.service.js";

const record = (over: Partial<PayoutRecord> = {}): PayoutRecord & { saves: number } => {
  const r: any = { _id: "p1", amount: 22.08, printerId: "partner1", retryCount: 0, status: "processing", stripeTransferId: null, stripePayoutId: null, saves: 0, ...over };
  r.save = async () => {
    r.saves += 1;
  };
  return r;
};

const fakeStripe = (opts: { existingTransfer?: string; transferError?: string; bankError?: string } = {}) => {
  const calls: string[] = [];
  let bank = 0;
  const steps: DeliverySteps = {
    findTransfer: async () => {
      calls.push("find");
      return opts.existingTransfer ? { id: opts.existingTransfer } : null;
    },
    createTransfer: async (_acct, cents, _payoutId, _printerId, attempt) => {
      calls.push(`transfer ${cents} #${attempt}`);
      if (opts.transferError) throw new Error(opts.transferError);
      return { id: "tr_1" };
    },
    createBankPayout: async (_acct, cents, _payoutId, _printerId, attempt) => {
      calls.push(`bank ${cents} #${attempt}`);
      if (opts.bankError) throw new Error(opts.bankError);
      bank += 1;
      return { id: `po_${bank}` };
    },
  };
  return { steps, calls };
};

describe("deliverPayout", () => {
  it("transfers, records the transfer at once, then pays out to the bank", async () => {
    const p = record();
    const { steps, calls } = fakeStripe();
    const result = await deliverPayout(p, "acct_1", steps);
    assert.deepEqual(result, { outcome: "sent", transferId: "tr_1", bankPayoutId: "po_1" });
    assert.deepEqual(calls, ["find", "transfer 2208 #0", "bank 2208 #0"]);
    assert.equal(p.stripeTransferId, "tr_1");
    assert.equal(p.stripePayoutId, "po_1");
    assert.equal(p.saves, 1, "the transfer is saved before the bank step can fail");
  });

  it("keeps the transfer when the bank step fails, and says the money is in the partner's balance", async () => {
    const p = record();
    const { steps } = fakeStripe({ bankError: "Your account has insufficient funds to cover the transfer." });
    const result = await deliverPayout(p, "acct_1", steps);
    assert.equal(result.outcome, "bank_failed");
    assert.equal(p.stripeTransferId, "tr_1");
    assert.match(result.outcome === "bank_failed" ? result.reason : "", /in their Stripe balance/);
  });

  it("only repeats the bank step on a retry: never a second transfer", async () => {
    const p = record({ stripeTransferId: "tr_1", stripePayoutId: "po_old", retryCount: 1 });
    const { steps, calls } = fakeStripe();
    const result = await deliverPayout(p, "acct_1", steps);
    assert.deepEqual(calls, ["bank 2208 #1"]);
    assert.equal(result.outcome, "sent");
    assert.equal(p.stripePayoutId, "po_1");
  });

  it("finds a transfer Stripe made that our record missed, instead of making another", async () => {
    const p = record({ retryCount: 1 });
    const { steps, calls } = fakeStripe({ existingTransfer: "tr_earlier" });
    await deliverPayout(p, "acct_1", steps);
    assert.deepEqual(calls, ["find", "bank 2208 #1"]);
    assert.equal(p.stripeTransferId, "tr_earlier");
  });

  it("doesn't try the bank when the transfer itself was refused", async () => {
    const p = record();
    const { steps, calls } = fakeStripe({ transferError: "Insufficient available balance." });
    const result = await deliverPayout(p, "acct_1", steps);
    assert.deepEqual(result, { outcome: "transfer_failed", reason: "Stripe refused the transfer: Insufficient available balance." });
    assert.deepEqual(calls, ["find", "transfer 2208 #0"]);
    assert.equal(p.stripeTransferId, null);
  });
});

describe("bankPayoutChange", () => {
  const paid = { status: "paid", stripePayoutId: "po_2" };

  it("ignores an event about an earlier attempt", () => {
    assert.equal(bankPayoutChange(paid, { id: "po_1", status: "failed" }), null);
  });

  it("marks a bounced payout failed, once", () => {
    const change = bankPayoutChange(paid, { id: "po_2", status: "failed", failure_message: "The bank account has been closed." });
    assert.equal(change?.status, "failed");
    assert.match(change?.failureReason || "", /The bank account has been closed\. The money is in their Stripe balance/);
    assert.equal(bankPayoutChange({ status: "failed", stripePayoutId: "po_2" }, { id: "po_2", status: "failed" }), null);
  });

  it("never turns a failed payout back into paid", () => {
    assert.equal(bankPayoutChange({ status: "failed", stripePayoutId: "po_2" }, { id: "po_2", status: "paid" }), null);
  });

  it("marks a payout paid when its bank payout arrives", () => {
    assert.deepEqual(bankPayoutChange({ status: "processing", stripePayoutId: "po_2" }, { id: "po_2", status: "paid" }), { status: "paid" });
    assert.equal(bankPayoutChange(paid, { id: "po_2", status: "paid" }), null);
  });
});
