## Payments (Stripe)

This server exposes the customer-authenticated payment endpoint used by the
checkout modal.

### Stripe

Required env:

- `STRIPE_SECRET_KEY`

Endpoint:

- `POST /api/customer/payments/stripe/create-intent`
  - Body: `{ items: [...], shippingMethod: "standard" | "express" }`
  - Returns: `{ clientSecret, paymentIntentId, pricing }`

Without `STRIPE_SECRET_KEY` the endpoint returns 500 and the checkout UI shows a
"card payments are unavailable" notice rather than collecting card details.

### Notes

- Mounted under `/api/customer/*` and requires a valid customer JWT
  (`Authorization: Bearer ...`).
- Amounts are computed server-side from the provided items + shipping method.
  Note that `unitPrice` still comes from the client — the totals are internally
  consistent but not yet verified against the stored design price, and the
  created order is not checked against the PaymentIntent.

### Removed

PayPal (`/payments/paypal/create-order`, `/payments/paypal/capture-order`) was
built in March 2026 but never credentialed and never reachable from the UI. It
also could not have persisted a payment: the `Order` schema's `payment`
sub-document defines only `method`, `cardLast4`, `cardBrand` and
`paymentIntentId`, so Mongoose's default strict mode would have silently dropped
`paypalOrderId` and `paypalCaptureId` on save. It was removed rather than left
as a half-wired payment path; see git history if it is ever revived.
