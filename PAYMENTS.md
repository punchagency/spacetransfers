# Payments (Stripe)

Customers pay by card at checkout; partners are paid through Stripe Connect.
Both run on one Stripe account (the client's). The money flow is "Customer → You
→ Recipient": the platform takes the payment, then transfers each partner's
share to their Express account.

Settings: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (for the Connect webhook
below) and `MINIMUM_PAYOUT_AMOUNT_CENTS` (default 1000). The store needs the
publishable key as `VITE_STRIPE_PUBLISHABLE_KEY`.

### Taking a payment

- `POST /api/customer/payments/stripe/create-intent` (customer session)
  - Body: `{ items: [...], shippingMethod: "standard" | "express", shippingAddress: { street, city, state, postalCode, country } }`
  - Returns `{ clientSecret, paymentIntentId, pricing }`.
  - The amount is priced on the server from the sheets themselves (their area
    and the current rates) and a live shipping quote for the address. A
    `unitPrice` sent by the client is never used.
- `POST /api/customer/orders` then records the order. The payment is checked with
  Stripe first: it must have succeeded, belong to this customer and match the
  order's total to the cent, or no order is created.
- Without `STRIPE_SECRET_KEY` the endpoint answers 500 and checkout shows that
  card payments are unavailable instead of collecting card details.

**A payment without an order** (checkout closed between the charge and the
order, or the order refused) is caught by the payment check every 10 minutes and
reported to the admins once; see "Background jobs" in the README.

**Refunds** are made by an admin from the order page
(`POST /api/admin/orders/:orderId/refund`), in full or in part, and recorded on
the order.

### Paying partners

1. **Connecting.** A partner opens Settings → Payout Settings → Connect Stripe
   Account (`POST /api/payouts/printer/connect`). This creates an Express account
   that can only receive transfers, with payouts to the bank on manual, and
   returns Stripe's onboarding link. The Connect branding (name, icon, colours)
   is set in the Stripe dashboard.
2. **Drafting.** A partner's shipped, unpaid jobs are payable. Each Friday the
   scheduler drafts a payout per partner owed at least the minimum and tells the
   admins; an admin can also create one any time (`POST /admin/create`). A job
   in any payout that isn't rejected is never put in another.
3. **Approving and paying.** Both are explicit admin actions: `approve`, then
   `process`. Nothing pays automatically.
4. **What paying does.** A transfer from the platform's balance to the partner's
   Stripe balance, then a payout from there to their bank. The transfer happens
   once per payout, ever: it is recorded the moment it succeeds, and Stripe is
   checked for one before another is made. If the bank refuses the payout, the
   money stays in the partner's Stripe balance; **Try payment again**
   (`POST /admin/retry/:payoutId`) repeats only the bank step. A payout whose
   money has moved can't be rejected, because that would free its jobs to be
   paid again.
5. **Outcome.** Stripe's webhook reports the bank payout's result. A failed one
   marks the payout failed, alerts the admins and asks the partner to check
   their bank details.

Endpoints under `/api/payouts`:

| Who | Endpoints |
| --- | --- |
| Partner | `POST /printer/connect`, `GET /printer/connect/status`, `GET /printer/summary`, `GET /printer/history`, `GET /printer/export` |
| Admin | `GET /admin/list`, `GET /admin/stats`, `GET /admin/printers`, `GET /admin/printers/:printerId/eligible`, `POST /admin/create`, `GET /admin/:payoutId/jobs`, `POST /admin/:payoutId/approve`, `POST /admin/:payoutId/reject`, `POST /admin/:payoutId/process`, `POST /admin/retry/:payoutId`, `PATCH /admin/printers/:printerId/toggle`, `GET /admin/export` |
| Stripe | `POST /webhook` |

### The webhook

`POST /api/payouts/webhook` takes Connect events: `account.updated` (a partner
finished onboarding), `payout.paid` and `payout.failed`. It must receive the raw
body to check Stripe's signature, which `app.ts` arranges. Register it, and get
its signing secret, with:

```bash
node scripts/setup-stripe-webhook.mjs https://api.yourdomain.com
```

Run it once per Stripe mode: the test and live keys each need their own endpoint
and secret.

### Removed

PayPal (`/payments/paypal/create-order`, `/payments/paypal/capture-order`) was
built in March 2026 but never credentialed and never reachable from the UI. It
also could not have persisted a payment: the `Order` schema's `payment`
sub-document had no fields for it, so Mongoose's strict mode would have silently
dropped `paypalOrderId` and `paypalCaptureId` on save. It was removed rather than
left as a half-wired payment path; see git history if it is ever revived.
