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

External services: Stripe (payments and partner payouts), Cloudflare R2 (artwork storage), EasyPost (shipping rates, labels, tracking), Resend (email), Google Gemini (AI image edits), Google sign-in.

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
| EasyPost key | Shipping falls back to the flat rates; labels cannot be bought |
| Resend key | Emails are skipped and logged |
| Gemini key | AI image edits are unavailable; board commands still work |
| `SENTRY_DSN` | Errors are logged but not reported |
| `BACKUP_ENABLED` | No nightly backups |

`EASYPOST_LABELS_ENABLED` must stay `false` wherever the key is a production key and no real postage is wanted. With a test key, labels and tracking are simulated and free, so it can be `true` on staging.

## Deploying

Production runs on Render from `render.yaml` at the root of the repo that holds all four apps: this API as a Docker service (the [Dockerfile](Dockerfile)) and the three front ends as static sites. Each service builds from its own folder and redeploys only when that folder changes on `main`.

- **One API instance.** The background jobs have no lock, so a second instance would run each of them twice.
- **Health check.** `/api/health` answers 503 until the database is connected, so a deploy that can't reach it never goes live.
- **Memory.** A print export draws the sheet at 300 DPI in memory; one 100in part of a dense sheet peaks near 2.3 GB. `EXPORT_RENDER_CONCURRENCY=1` renders them one at a time, and others wait their turn; previews aren't held up.

### Until launch: the free plan

The API starts on Render's free plan. It is enough to try everything except long print exports, with these limits:

- **512 MB of memory.** A print export of a long or dense sheet runs out and the API restarts. Short sheets and previews work.
- **It sleeps after 15 minutes without a request** and takes about a minute to wake. While asleep, the background jobs don't run: tracking, the payment check, backups. Webhooks that arrive while it wakes are retried by Stripe and EasyPost.
- **No disk.** Print exports are lost when it restarts or sleeps; the partner exports again.
- **No Shell.** Run the scripts from your machine instead, in this folder after `npm install`, with the production values on the command line. Anything not given there is read from your local `.env`, so give every value the script needs:

  ```bash
  MONGO_URI='<production connection string>' node scripts/create-admin.mjs "Name" email@company.com
  STRIPE_SECRET_KEY='<key>' node scripts/setup-stripe-webhook.mjs https://<api address>
  EASYPOST_API_KEY='<key>' EASYPOST_WEBHOOK_SECRET='<value from Render>' node scripts/setup-easypost-webhook.mjs https://<api address>
  ```

  `create-admin` prints the database it wrote to: check it is the production one. Atlas must allow your address (Network Access) while you run it.

**At launch** set `plan: pro` (4 GB) in render.yaml and add the disk shown there (`/app/uploads`, which keeps print exports between deploys). A service with a disk stops the old instance before starting the new one, so each deploy then has a short gap. From then on the scripts can also run from the API's Shell tab, in `/app`.

### In this order

1. **MongoDB Atlas.** A cluster in the region nearest Render's (`virginia` in render.yaml), a database user for the API, and the connection string with the database name in it. Under Network Access, allow the API's outbound addresses (Render → the API service → Connect → Outbound).
2. **Cloudflare R2.** A public bucket for artwork, with the CORS rule in `.env.example`, and a private bucket for backups. An API token with read and write on both. Choose the final public address before any real upload: it is written into the database.
3. **Render.** New → Blueprint, the repo. Fill in the values it asks for. `JWT_SECRET` and `EASYPOST_WEBHOOK_SECRET` are generated. Generate `BACKUP_ENCRYPTION_KEY` with `openssl rand -hex 32` and keep a copy outside Render.
4. **Stripe Connect.** Partners are paid through Express connected accounts: complete the platform profile and the Connect branding (name, colour, icon) in the Stripe Dashboard before any partner connects.
5. **Webhooks.** `setup-stripe-webhook.mjs` prints the Stripe signing secret once: set it as `STRIPE_WEBHOOK_SECRET`. Then `setup-easypost-webhook.mjs`.
6. **Domains.** Add each custom domain to its Render service and the DNS records Render shows. Then update `APP_URL`, `ADMIN_APP_URL`, `PRINTER_APP_URL` on the API and `VITE_API_URL`, `VITE_STORE_URL`, `VITE_SITE_URL` on the front ends, and run step 5 again for the new API address.
7. **Resend.** Verify the sending domain (DNS records in Resend), and set `RESEND_FROM_EMAIL` to an address on it.
8. **Admins.** `create-admin.mjs` once `ADMIN_APP_URL` is final. Passkeys belong to the admin console's address, so one registered on a temporary address stops working when the domain changes; the admin then signs in with a recovery code and registers a new one.
9. **Sentry.** One project per app in the `space-transfers` organization; their DSNs are already in render.yaml, and each deployment says whether it is `production` or `staging`. For readable stack traces from the front ends, create an organization token (Sentry → Settings → Organization Tokens) and set it as `SENTRY_AUTH_TOKEN` on the three static sites: each build uploads its source maps and then deletes them, so they are never served. Without it the builds are unchanged and the traces show minified code.
10. **Google and Gemini**, when they arrive: one OAuth client, with the store's and printer portal's addresses as authorised JavaScript origins. Its id goes in `GOOGLE_CLIENT_ID` on the API and `VITE_GOOGLE_CLIENT_ID` on the store (Sign in with Google) and the printer portal (saving print files to Google Drive; the buttons are hidden until it is set). Then `GEMINI_API_KEY`.
11. **Launch.** The plan and disk above. Swap the Stripe test keys for live ones (`STRIPE_SECRET_KEY`, the store's `VITE_STRIPE_PUBLISHABLE_KEY`) and run the Stripe webhook script again with the live key. Swap in the EasyPost production key, set `EASYPOST_LABELS_ENABLED=true` and run the EasyPost webhook script again.

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

### Shipping

Shipping is through EasyPost (`services/easypost.service.ts`, `services/shippingLabel.service.ts`).

- **Quotes.** Checkout asks for live rates from the partner most likely to ship the order (`predictShippingOrigin`), for a parcel sized from the sheets' area by the packaging bands in the admin console. Standard is the cheapest service; express is the cheapest faster one. The admin's markup is added. Without EasyPost, or when it fails, the flat rates are charged and the order records why.
- **Labels.** Marking a job ready to ship (`QUALITY_CHECK`) buys the label in the background: a 4x6 PDF, from the partner's business address, on the service the customer was quoted, for the same parcel. The shipment is saved before it is bought, so a retry after a failure finds a label that was bought rather than buying another. A failure is shown to the partner with a Try again button and sent to the admins.
- **Tracking.** EasyPost's `tracker.updated` webhook (`POST /api/webhooks/easypost`, signed with `EASYPOST_WEBHOOK_SECRET`) and the poller move an order to `SHIPPED` when the carrier has it and to `COMPLETED` when it's delivered. Returns and delivery failures are sent to the admins. The customer sees the carrier's status, the expected date and a tracking link.
- **Unused labels.** A label is sent back for a refund when its order is cancelled, and when the job is handed back or reassigned. In the last two cases it is also cleared, so the next partner makes their own.

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
- **What the server will fetch.** Any address a caller supplies goes through `fetchStoredArtwork`, which refuses everything but our own stored files and does not follow redirects. The EasyPost key is only sent to `api.easypost.com`, and EasyPost's webhook is accepted only with a valid signature.
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
| Tracking poller | Every 30 minutes, asks EasyPost about parcels not yet delivered, as a backup to the webhook: ships an order the carrier has picked up, completes a delivered one |
| SLA monitor | Reassigns or escalates late jobs; off until enabled in the admin console |
| Payout scheduler | Each Friday from 09:00 UTC (later that Friday if the server was asleep), puts partners' payable, unpaid jobs into payouts for an admin to review and tells the admins. It never sends money |
| Notification email batches | Every 10 seconds, sends queued admin notification emails; a failed send is tried again, up to three times |
| Unanswered cancellations | Every 30 minutes, tells the admins about any customer cancellation request a partner has left for 12 hours, and reminds the partner, once |
| Backups | At 03:00 UTC, when `BACKUP_ENABLED=true`, writes an encrypted copy of every collection to R2 and keeps the last 30. A server that starts after 03:00 without today's backup makes it then. A failure is sent to Sentry and the admins |
| Export cleanup | Every 6 hours, removes print exports and previews older than `EXPORT_RETENTION_DAYS` (14) from the disk; they are made again on request |

A job that fails is reported to Sentry, tagged with the job's name. The jobs run on timers inside the API, so they only run while it's awake (see the free plan above), and only one API may run them.

## Scripts

| Script | Use |
| --- | --- |
| `node scripts/create-admin.mjs "Name" email@company.com` | Creates an admin account, the only way to make one |
| `node scripts/setup-easypost-webhook.mjs https://api-address` | Registers EasyPost's tracking webhook (once per key mode) |
| `node scripts/setup-stripe-webhook.mjs https://api-address` | Registers Stripe's Connect webhook for partner payouts and onboarding (once per key mode); prints the signing secret once |
| `node scripts/test-easypost.mjs [from-zip] [to-zip]` | Checks the EasyPost key and lists the carriers and rates it offers. Buys nothing |
| `node dist/tools/shipping.js migrate [--apply]` | Run once after deploying EasyPost: moves orders off the old ShipStation fields |
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
