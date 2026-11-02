/**
 * Paying a partner is two steps on Stripe: a transfer from the platform to the
 * partner's Stripe balance, then a payout from that balance to their bank.
 *
 * Only the first moves the platform's money, so it happens once per payout and
 * is recorded the moment it succeeds. When the bank step fails (a closed or
 * mistyped account, say) the money waits in the partner's Stripe balance, and
 * trying again repeats only the bank step. Before this, a retry repeated both,
 * and every retry paid the partner again.
 */

export interface PayoutRecord {
  _id: unknown;
  amount: number;
  printerId: unknown;
  retryCount: number;
  status: string;
  stripeTransferId?: string | null;
  stripePayoutId?: string | null;
  failureReason?: string | null;
  processedAt?: Date | null;
  save(): Promise<unknown>;
}

export interface DeliverySteps {
  findTransfer(stripeAccountId: string, payoutId: string): Promise<{ id: string } | null>;
  createTransfer(stripeAccountId: string, amountCents: number, payoutId: string, printerId: string, attempt: number): Promise<{ id: string }>;
  createBankPayout(stripeAccountId: string, amountCents: number, payoutId: string, printerId: string, attempt: number): Promise<{ id: string }>;
}

export type Delivery =
  | { outcome: "sent"; transferId: string; bankPayoutId: string }
  | { outcome: "transfer_failed"; reason: string }
  | { outcome: "bank_failed"; transferId: string; reason: string };

const messageOf = (err: unknown) => (err as any)?.message || "no reason given";

/**
 * Runs the steps a payout still needs and records each as it completes. Leaves
 * the status to the caller, which records it with who did what.
 */
export const deliverPayout = async (payout: PayoutRecord, stripeAccountId: string, steps: DeliverySteps): Promise<Delivery> => {
  const payoutId = String(payout._id);
  const printerId = String(payout.printerId);
  const amountCents = Math.round(payout.amount * 100);

  if (!payout.stripeTransferId) {
    try {
      const transfer =
        (await steps.findTransfer(stripeAccountId, payoutId)) ??
        (await steps.createTransfer(stripeAccountId, amountCents, payoutId, printerId, payout.retryCount));
      payout.stripeTransferId = transfer.id;
      await payout.save();
    } catch (err) {
      return { outcome: "transfer_failed", reason: `Stripe refused the transfer: ${messageOf(err)}` };
    }
  }

  try {
    const bank = await steps.createBankPayout(stripeAccountId, amountCents, payoutId, printerId, payout.retryCount);
    payout.stripePayoutId = bank.id;
    return { outcome: "sent", transferId: payout.stripeTransferId, bankPayoutId: bank.id };
  } catch (err) {
    return { outcome: "bank_failed", transferId: payout.stripeTransferId, reason: bankFailureReason(messageOf(err)) };
  }
};

/** Why a bank payout failed, and what trying again will and won't do. */
export const bankFailureReason = (stripeMessage: string) =>
  `The partner's bank payout failed: ${stripeMessage} The money is in their Stripe balance; once their bank details are fixed, trying again sends it without paying twice.`;

/**
 * What a bank payout's current state on Stripe means for our record, or null
 * when nothing changes. Only the payout's latest bank payout counts: an event
 * about an earlier attempt must not overwrite the outcome of a later one.
 */
export const bankPayoutChange = (
  record: Pick<PayoutRecord, "status" | "stripePayoutId">,
  bank: { id: string; status: string; failure_message?: string | null },
): { status: "paid" | "failed"; failureReason?: string } | null => {
  if (record.stripePayoutId !== bank.id) return null;
  if (bank.status === "failed" && record.status !== "failed") {
    return { status: "failed", failureReason: bankFailureReason(bank.failure_message || "the bank gave no reason.") };
  }
  if (bank.status === "paid" && record.status !== "paid" && record.status !== "failed") return { status: "paid" };
  return null;
};
