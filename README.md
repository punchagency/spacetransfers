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
| `SENTRY_DSN` | Errors are logged but not reported |
| `BACKUP_ENABLED` | No nightly backups |

`SHIPSTATION_LABELS_ENABLED` must stay `false` outside production. ShipStation has no sandbox, so a label bought in testing is a real purchase.

## Layout

```ts
src/
  server.ts        Starts the API and the background jobs
  app.ts           Express app: CORS, body limits, routes, error handling
  config/          Environment, and the first wording of the legal documents
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
  tools/           Command-line tools run from the build (backups)
  tests/           Unit tests
scripts/           One-off operational scripts
```

All routes are served under `/api`: `/auth`, `/customer`, `/printer`, `/admin`, `/payouts`, `/geocode`, `/webhooks`, `/public`, `/health`.

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

### Assignment

With the rule on **Nearest Region** a paid order is assigned as soon as it is placed. Only partners who are active, open and under their job limit are considered. The order goes to a partner in the customer's region: one in the customer's own state first, otherwise the nearest, then the least loaded, then the best rated. If the region has nobody free, the next region in `REGION_FALLBACKS` is tried and admins are told. If nobody is free anywhere the order stays `PENDING` and admins are alerted. A partner who handed a job back is not offered it again. Orders still waiting for a partner are retried every 5 minutes and whenever the settings are saved, so an order placed under Manual, or when nobody was free, is picked up once it can be. The logic is in `services/orderAssignment.service.ts`.

Partners can only move a job forward, and they cannot cancel an order: a partner who can't do a job hands it back to the queue to be reassigned. `SHIPPED` needs a shipping label, and `COMPLETED` is set only when the carrier confirms delivery, because it makes the job payable. The rules are in `utils/partnerStatusRules.ts`.

### Print files

A partner's PNG export is the full roll width the order was built on (23.5in, 7,050px at 300 DPI) and as long as the artwork: down to the lowest graphic plus the sheet margin. A sheet billed at the minimum length is not padded out to it. Sheets longer than 100in are split into parts between graphics. See `printFileLengthIn` in `services/gangsheetExport.service.ts`.

## Reprints and cancellations

A report resolved with a reprint creates a free order. It holds the whole order, the sheets and quantities the admin chose (`reprintItems: [{ index, quantity }]`), or individual designs (`reprintDesigns: [{ sheet, design, copies }]`). Chosen designs are packed onto a new, shorter sheet, one per original sheet, with the export's own placement maths (`services/sheetDesigns.service.ts`), and the sheet gets a fresh preview. The admin must also say whether the partner is paid (`payPartner`). An unpaid reprint (`reprintOf.partnerPaid: false`) counts $0 in every earnings, payout and profit figure; older reprints with no choice recorded are paid. `GET /customer/orders/:id/designs` and `GET /admin/orders/:id/designs` return each sheet's designs with where every copy prints. A customer reporting a problem can mark the affected designs (`affectedDesigns`), which the admin's picker starts with. It is assigned before it is first saved to the partner who printed the original, bypassing matching, the manual-assignment setting and their job limit. If that partner isn't Active or Under Review, it goes through normal assignment and the admins are told why.

A customer cancels with `POST /customer/orders/:id/cancel`. An order with no partner yet is cancelled and refunded at once. Otherwise a cancellation request is recorded on the order and the partner answers with `POST /printer/orders/:id/cancellation` (`accept`, or `decline` with a reason). While the request is open the partner can't move the job on or hand it back. An order that ships anyway, or that an admin cancels, settles the request. `POST /customer/orders/:id/cancel/withdraw` takes it back.

## Money

- **Pricing** is always computed on the server (`services/pricing.service.ts`). A sheet is billed as roll width times its length, with a minimum length. Express shipping adds a rush fee. Rates are set in the admin console.
- **Checkout** shows the server's quote, and the card is charged by the same calculation.
- **Order lines** on the invoice, the order details and the confirmation email come from one helper (`utils/orderPresentation.ts`).
- **Admin profit** is what the customer paid, less tax, shipping cost, partner cost and the Stripe fee (`services/orderFinancials.service.ts`).
- **Sessions.** A session token carries the account's token version; raising the version ends every session issued before it, which is what a password change, a password reset and a passkey reset do. A suspended or rejected account is refused on its next request, not at next sign-in. Admin sessions last 24 hours. The token is read from the `Authorization` header; the address is accepted only on the two file downloads a browser saves directly (`middleware/auth.ts`).
- **Passkeys** are the second step of sign-in (`services/passkey.service.ts`). An account with one answers the right password with a challenge, not a session; the passkey or a one-time recovery code completes it. Admins must have one: the admin and payout routes answer 403 `PASSKEY_REQUIRED` until they do. Partners and customers may add one. Removing a passkey or renewing recovery codes asks for the password again. An admin can reset another account's passkeys with a reason; every admin is notified and that account is signed out.
- **What the server will fetch.** Any address a caller supplies goes through `fetchStoredArtwork`, which refuses everything but our own stored files and does not follow redirects. ShipStation credentials are sent only to ShipStation's host.
- **Limits.** Sign-in, registration, password reset and the passkey step are limited per address; uploads and the image checks per account or address; AI edits and resolution boosts need an account and are limited per account (`middleware/rateLimit.ts`).
- **Start-up checks.** The server will not start on a deployment without a `JWT_SECRET` of at least 32 characters. Returning a reset token in the API response needs `EXPOSE_RESET_TOKENS=true` and is honoured only on a developer's machine.
- **Cancelling an order** is an admin action, allowed until the order ships. The refund is made through Stripe first, and the order is cancelled only once the refund is accepted (`services/orderCancellation.service.ts`). It is everything not yet refunded unless the admin chooses a smaller amount, or none. The customer is emailed and the partner is told to stop. If the partner had already started the job, the admin can choose to pay them for it anyway; the job then counts as payable like a shipped one (`payableOrderFilter` in `services/partnerEarnings.service.ts`).
- **Refunds** can also be made without cancelling, in part or in full, on any order paid by card (`services/orderRefund.service.ts`, `POST /admin/orders/:orderId/refund`). Each refund is kept on the order (`payment.refunds`), several add up, and together they can never exceed what was paid. A refund comes straight off the order's profit; the partner's pay is not affected.
- **Reported problems.** A customer reports a problem with an order from Order History: it didn't arrive, arrived damaged, needs a reprint, or something else (`models/orderIssue.model.ts`). Every admin is notified. The admin has two separate conversations on the report, one with the customer and one with the partner who printed it; neither side sees the other's (`services/orderIssue.service.ts`). The admin settles it with a refund of a chosen amount, a free reprint, or an explanation. A customer's reply to a settled report reopens it. The customer can attach up to four photos to a report or a message (`POST /customer/issues/photos`); each is turned upright, shrunk to 2000px and re-saved as a JPEG under `issues/<userId>/`, which also drops the location a phone embeds. Only the admin and the customer see them. The partner's job lists carry a flag for each order with an open question (`partnerIssueFlags`), and `GET /printer/issues` lists them all.
- **A free reprint** is a new order of the same sheets to the same address at no charge, linked to the original by `reprintOf` (`services/orderReprint.service.ts`). It is assigned, printed, shipped and paid to the partner like any order, so its profit is the cost of the print and postage.
- **Placing an order** checks the request and builds each item in `services/orderCreation.service.ts`; the `createOrder` handler prices shipping, verifies the payment, saves and runs the follow-ups.
- **Payouts** gather a partner's shipped, unpaid jobs. A payout must be approved and then paid by an admin (`/payouts/admin/*`); the weekly scheduler only creates payouts for review.
- **Partner pay** is a per-square-foot rate plus a rush percentage (`services/partnerEarnings.service.ts`).

More detail: [PAYMENTS.md](PAYMENTS.md) and [AI_EDITING.md](AI_EDITING.md).

## Background jobs

Started by `server.ts` in every environment except tests:

| Job | What it does |
| --- | --- |
| Payment check | Every 10 minutes, reports any card payment that has no order to the admins |
| Waiting orders | Every 5 minutes, offers unassigned orders to automatic assignment; idle while the rule is Manual |
| Tracking poller | Marks shipped orders completed when the carrier confirms delivery |
| SLA monitor | Reassigns or escalates late jobs; off until enabled in the admin console |
| Payout scheduler | Each Friday, puts partners' payable, unpaid jobs into payouts for an admin to review. It never sends money |
| Notification email batches | Sends queued admin notification emails |
| Unanswered cancellations | Every 30 minutes, tells the admins about any customer cancellation request a partner has left for 12 hours, and reminds the partner, once |
| Backups | At 03:00 UTC, when `BACKUP_ENABLED=true`, writes an encrypted copy of every collection to R2 and keeps the last 30 |

## Scripts

| Script | Use |
| --- | --- |
| `node scripts/create-admin.mjs "Name" email@company.com` | Creates an admin account, the only way to make one |
| `node scripts/setup-shipstation-webhooks.mjs` | Registers the ShipStation tracking webhook |
| `node scripts/test-shipstation-integration.mjs` | Checks the ShipStation credentials |
| `node scripts/migrate-design-thumbnails.mjs` | One-off move of old design thumbnails into R2 |
| `node dist/tools/backup.js backup` | Takes a backup now |
| `node dist/tools/backup.js list` | Lists the stored backups |
| `node dist/tools/previews.js report` / `rerender --apply` | Order sheet previews are drawn small (50 DPI, lossy WebP). Run once after deploying this change to re-draw older full-resolution ones (they reached 40 MB each); old files are removed once nothing points at them |
| `node dist/tools/backup.js drill` | Restores the latest backup into a scratch database, compares it with the live one, and drops it. Run it after setting up backups and from time to time |
| `node dist/tools/backup.js restore <date> <database>` | Restores a backup into the named database. It refuses the live one, so restore beside it and switch over |

## Legal documents

The Terms of Service, Privacy Policy and Content Policy are stored in the database and edited by admins in the admin console. On first start each one is seeded from `config/legalSeed.ts`. Every publish creates a new version named by its date and needs a note saying what changed. Earlier versions are kept and stay readable.

The store and the partner portal read the published versions from `/api/public/legal`. A sign-up records the versions the person agreed to and is refused if those are no longer current. People who signed up earlier keep the versions they accepted. Nobody is asked to accept again.

## Backups

A backup is gzipped, then encrypted with AES-256-GCM under `BACKUP_ENCRYPTION_KEY`, and stored under `backups/<date>/` in `BACKUP_R2_BUCKET` (by default `R2_BUCKET`). Generate the key with `openssl rand -base64 32` and keep a copy outside the server. Without the key the backups cannot be read. In production, use a private bucket of their own.

## Customers' data

Account Settings in the store lets a customer download everything held about them (`GET /customer/account/export`) and close their account (`POST /customer/account/delete`). Closing needs their password, or their typed email address if they sign in with Google. It is refused while any of their orders is still being made or delivered or a problem report is open, and for a sub-account, which its main account removes. Closing deletes the sign-in, saved sheets, uploads and sign-in history. It also deletes stored files that no order uses. Orders are kept for the business's records and marked `accountDeletedAt`.

## Partners closing their account

A partner closes their account from Settings in the partner portal (`GET`/`POST /printer/account/close`). It is refused while a job is in progress, a customer report on one of their jobs is open, or money is still owed to them (jobs not yet paid out, or a payout not yet settled). Closing needs their password. The record is kept, because jobs and payouts point at it and payout records are needed for accounting and tax. Their status becomes Closed, every session ends, and their password, passkeys, phone, website, logo, certifications, notifications and sign-in history are removed. Admins are notified. A closed partner can't sign in, reset a password or be given work, and can re-apply with the same email, which puts them back in the approvals queue.
