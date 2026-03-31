## Payments (Stripe + PayPal)

This server exposes customer-authenticated payment endpoints used by the checkout modal.

### Stripe

Required env:
- `STRIPE_SECRET_KEY`

Endpoint:
- `POST /api/customer/payments/stripe/create-intent`
  - Body: `{ items: [...], shippingMethod: "standard" | "express" }`
  - Returns: `{ clientSecret, paymentIntentId, pricing }`

### PayPal

Required env:
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENV` (`sandbox` or `live`, defaults to `sandbox`)

Endpoints:
- `POST /api/customer/payments/paypal/create-order`
  - Body: `{ items: [...], shippingMethod: "standard" | "express" }`
  - Returns: `{ paypalOrderId, pricing }`
- `POST /api/customer/payments/paypal/capture-order`
  - Body: `{ paypalOrderId }`
  - Returns: `{ paypalOrderId, paypalCaptureId, status }`

### Notes

- These endpoints are mounted under `/api/customer/*` and require a valid customer JWT (`Authorization: Bearer ...`).
- Amounts are computed server-side from the provided items + shipping method.

