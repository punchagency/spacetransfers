import Stripe from "stripe";
import { env } from "../config/env.js";

// TEST MODE ONLY — switch to live key via STRIPE_SECRET_KEY env var when ready
const stripeSecretKey = env.stripeSecretKey || "sk_test_placeholder";

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2025-08-27.basil",
});

export const MINIMUM_PAYOUT_AMOUNT_CENTS = 1000; // $10.00 minimum

/**
 * Create a Stripe Connect account link for onboarding a printer (test mode).
 */
export async function createConnectAccountLink(
  stripeAccountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return link.url;
}

/**
 * Create a new Stripe Express Connect account (test mode).
 */
export async function createConnectAccount(email: string): Promise<string> {
  const account = await stripe.accounts.create({
    type: "express",
    email,
    capabilities: {
      transfers: { requested: true },
    },
    settings: {
      payouts: {
        schedule: { interval: "manual" },
      },
    },
  });
  return account.id;
}

/**
 * Retrieve a Connect account's details (test mode).
 */
export async function getConnectAccount(stripeAccountId: string) {
  return stripe.accounts.retrieve(stripeAccountId);
}

/**
 * Transfer funds to a printer's Connect account, then create a payout (test mode).
 * Returns the transfer and payout objects.
 */
export async function processPayoutTransfer(
  stripeAccountId: string,
  amountCents: number,
  payoutId: string,
  printerId: string
): Promise<{ transfer: Stripe.Transfer; payout: Stripe.Payout }> {
  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: "usd",
    destination: stripeAccountId,
    metadata: {
      payoutId,
      printerId,
      mode: "test",
    },
  });

  // Trigger an immediate payout on the connected account
  const payout = await stripe.payouts.create(
    {
      amount: amountCents,
      currency: "usd",
      metadata: {
        payoutId,
        printerId,
        mode: "test",
      },
    },
    { stripeAccount: stripeAccountId }
  );

  return { transfer, payout };
}

/**
 * Construct a Stripe webhook event from raw body and signature header.
 */
export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
  secret: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Get next Friday's date at 09:00 UTC.
 */
export function getNextFridayDate(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilFriday);
  next.setUTCHours(9, 0, 0, 0);
  return next;
}
