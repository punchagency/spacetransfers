# Space Transfers API

The backend for Space Transfers, a marketplace for DTF (direct-to-film) gang sheets. Customers build a sheet of artwork in the store and pay for it; the order goes to a print partner, who prints and ships it; the admin console oversees orders, partners and money.

This repo is the API all three front ends talk to.

| App | Repo | Who uses it |
| --- | --- | --- |
| Store | `space-transfers` | Customers: build sheets, check out, track orders |
| Admin console | `space-transfers-admin` | The business: orders, partners, pricing, earnings |
| Printer portal | `space-transfer-printer` | Print partners: accept, print and ship jobs |
| API | this repo | All of the above |

## Stack

Node.js (ES modules), Express, TypeScript, MongoDB with Mongoose. Tests run on Node's built-in test runner through `tsx`.

External services: Stripe (payments and partner payouts), Cloudflare R2 (artwork storage), ShipStation (rates, labels, tracking), Resend (email), Google Gemini (AI image edits), Google sign-in.

## Getting started

```bash
npm install
cp .env.example .env    # then fill it in; see below
npm run dev             # http://localhost:4000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API with reload on change |
| `npm test` | Runs the test suite |
| `npm run build` | Compiles to `dist/` |
| `npm start` | Runs the compiled build in production mode |

Run only one API against a given database. The background jobs below have no off switch, so two APIs on one database would both run them.

## Configuration

Every setting is documented in [.env.example](.env.example). `.env` is gitignored; never commit it.

The API will not start without `MONGO_URI` and `JWT_SECRET`. Everything else degrades one feature when it is missing:

| Missing | Effect |
| --- | --- |
| R2 keys | Uploads fail with a clear error |
| Stripe keys | Checkout cannot take payment |
| ShipStation keys | Shipping falls back to flat rates; labels cannot be bought |
| Resend key | Emails are skipped and logged |
| Gemini key | AI image edits are unavailable; board commands still work |

`SHIPSTATION_LABELS_ENABLED` must stay `false` outside production. ShipStation has no sandbox, so a label bought in testing is a real purchase.

## Layout

```ts
src/
  server.ts        Starts the API and the background jobs
  app.ts           Express app: CORS, body limits, routes, error handling
  config/          Environment and legal document versions
  routes/          URL to handler mapping, one file per audience
  controllers/     Request handlers
    customer/        assets, aiEdit, designs, cart, orders
    printer/         dashboard, jobs, files, earnings, account, notifications
    admin/           dashboard, orders, partners, settings, account, notifications
    *.controller.ts  auth, payments, payouts, webhooks, geocoding, health
  services/        Business logic: pricing, payments, shipping, export, email, notifications
  models/          Mongoose schemas
  middleware/      Authentication, rate limits, uploads
  utils/           Small pure helpers
  tests/           Unit tests
scripts/           One-off operational scripts
```

All routes are served under `/api`: `/auth`, `/customer`, `/printer`, `/admin`, `/payouts`, `/geocode`, `/webhooks`, `/health`.

## How an order moves

| Stored status | Customer sees | Partner sees | Admin sees |
| --- | --- | --- | --- |
| `PENDING` | Pending | (not assigned yet) | Unassigned |
| `PROCESSING` | Processing | Pending Review | Assigned |
| `PRINTING` | Processing | In Progress - Printing | Printing |
| `QUALITY_CHECK` | Processing | Print Shipping Label | Ready to Ship |
| `SHIPPED` | Shipped | Order Shipped | Shipped |
| `COMPLETED` | Completed | Completed | Completed |
| `CANCELLED` | Cancelled | Cancelled | Cancelled |

Partners can only move a job forward, and they cannot cancel an order: a partner who can't do a job hands it back to the queue to be reassigned. `SHIPPED` needs a shipping label, and `COMPLETED` is set only when the carrier confirms delivery, because it makes the job payable. The rules are in `utils/partnerStatusRules.ts`.

## Money

- **Pricing** is always computed on the server (`services/pricing.service.ts`). A sheet is billed as roll width times its length, with a minimum length. Express shipping adds a rush fee. Rates are set in the admin console.
- **Checkout** shows the server's quote, and the card is charged by the same calculation.
- **Order lines** on the invoice, the order details and the confirmation email come from one helper (`utils/orderPresentation.ts`).
- **Admin profit** is what the customer paid, less tax, shipping cost, partner cost and the Stripe fee (`services/orderFinancials.service.ts`).
- **Cancelling an order** is an admin action, allowed until the order ships. The payment is refunded in full through Stripe first, and the order is cancelled only once the refund is accepted (`services/orderCancellation.service.ts`). The customer is emailed and the partner is told to stop. If the partner had already started the job, the admin can choose to pay them for it anyway; the job then counts as payable like a shipped one (`payableOrderFilter` in `services/partnerEarnings.service.ts`).
- **Placing an order** checks the request and builds each item in `services/orderCreation.service.ts`; the `createOrder` handler prices shipping, verifies the payment, saves and runs the follow-ups.
- **Payouts** gather a partner's shipped, unpaid jobs. A payout must be approved and then paid by an admin (`/payouts/admin/*`); the weekly scheduler only creates payouts for review.
- **Partner pay** is a per-square-foot rate plus a rush percentage (`services/partnerEarnings.service.ts`).

More detail: [PAYMENTS.md](PAYMENTS.md) and [AI_EDITING.md](AI_EDITING.md).

## Background jobs

Started by `server.ts` in every environment except tests:

| Job | What it does |
| --- | --- |
| Payment check | Every 10 minutes, reports any card payment that has no order to the admins |
| Tracking poller | Marks shipped orders completed when the carrier confirms delivery |
| SLA monitor | Reassigns or escalates late jobs; off until enabled in the admin console |
| Payout scheduler | Each Friday, puts partners' payable, unpaid jobs into payouts for an admin to review. It never sends money |
| Notification email batches | Sends queued admin notification emails |

## Scripts

| Script | Use |
| --- | --- |
| `node scripts/create-admin.mjs "Name" email@company.com` | Creates an admin account, the only way to make one |
| `node scripts/setup-shipstation-webhooks.mjs` | Registers the ShipStation tracking webhook |
| `node scripts/test-shipstation-integration.mjs` | Checks the ShipStation credentials |
| `node scripts/migrate-design-thumbnails.mjs` | One-off move of old design thumbnails into R2 |
