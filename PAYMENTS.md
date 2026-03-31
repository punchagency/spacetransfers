## Checkout Payments (Stripe + PayPal)

The checkout payment step supports:
- Card payments via Stripe Elements
- PayPal payments via PayPal JS SDK

### Client env (Vite)

Create a `.env` in this folder with:

- `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_PAYPAL_CLIENT_ID`

If keys are missing, the UI shows "not configured yet" and disables that method.

### Server requirements

See the server doc: `../space-transfer-server/PAYMENTS.md`.

