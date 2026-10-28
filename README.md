# Space Transfers Admin

The admin console for Space Transfers, a marketplace for DTF (direct-to-film) gang sheets. The business uses it to watch orders, manage print partners, set prices and see what it earns.

It talks to the API in `space-transfer-server`. Customers use `space-transfers`, and print partners use `space-transfer-printer`.

## What an admin can do

- **Home.** Revenue, order counts and recent orders for a chosen period.
- **Orders.** Every order with its region, partner, status, amount and profit. An order's page shows the customer, each sheet's contents and preview, the timeline, the assigned partner, the shipment (carrier, tracking, where the parcel is, the label, and any unused label sent back for a refund) and the financials, and downloads the customer's invoice. An address the customer kept after the carrier questioned it at checkout is flagged on the order, with the carrier's version. Until an order ships it can be cancelled from its page, which refunds the customer in full unless a smaller amount is entered. Any card-paid order can also be refunded in part or in full without cancelling it, from the financials card. If a partner has already started the job, the dialog offers to pay them for it anyway.
- **Sign-in security.** Every admin needs a passkey: an account without one is held at a setup screen, and the server refuses it too. Profile → Security manages your own passkeys and recovery codes, lists every admin account with whether it has one, and lets you reset a colleague's if they are locked out. A partner's can be reset from their Settings tab. Changing your password signs your other devices out. Security headers for production are in `render.yaml` at the top of the repository, the same as `vercel.json` here.
- **Issues.** Problems customers report with their orders, the ones waiting on a reply first, with the open count in the menu. A report opens on its order, where the admin sees the customer's photos, writes to the customer and, separately, to the partner, and resolves it with a refund of a chosen amount, a free reprint, or a closing message.
- **Reprints and cancellation requests.** A free reprint can be the whole order, some sheets (each up to the quantity ordered), or individual designs picked on a drawing of the sheet, with how many copies of each. Designs the customer marked as affected start chosen. The admin must choose whether the partner is paid for it. It goes to the partner who printed the original, bypassing matching and their job limit. If that partner can't take work, it is offered to other partners and the admin is told. When a customer asks to cancel, the order page shows the request and the partner's answer. Cancel order settles it at any time.
- **Fulfilment Partners.** The partner list, each partner's details and performance, and manual order assignment. A partner who closed their own account shows as Closed. They can't be switched back on or given jobs, and a job can only be assigned to an Active or Under Review partner.
- **Approvals.** Approve or reject partners who signed up in the printer portal. A returning applicant who closed their account before is marked as such.
- **Earnings.** Revenue, partner cost, margin and what has been earned, with revenue by region.
- **Payouts.** What each partner is owed for shipped jobs. Create a payout, review its jobs, approve or reject it, then pay it through Stripe Connect. Nothing is paid without an admin approving and then paying it. Payouts can be paused per partner and exported as CSV.
- **Settings.** Retail price, sheet size, shipping rates, tax, the rush fee, partner pay, the assignment rule, partner job limits and the SLA.
- **Legal documents.** The Terms of Service, Privacy Policy and Content Policy, edited with a live preview. Save a draft, discard it, or publish it with a note saying what changed. Publishing makes the draft the current version for the store, the partner portal and new sign-ups. Version history shows every earlier wording, and any of them can be used as the starting point for a new draft. The first full drafts of the Terms and Privacy Policy are waiting there for legal review. Fill in the [bracketed] details before publishing.
- **Notifications.** Live alerts for new orders, partner sign-ups and problems such as a payment with no order.

## Stack

React 19, TypeScript, Vite, Tailwind CSS, Recharts. Tests run on Vitest.

## Getting started

```bash
npm install
cp .env.example .env    # set VITE_API_URL
npm run dev
```

The API must be running; see `space-transfer-server`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Runs the tests once |
| `npm run build` | Type-checks and builds to `dist/` |
| `npm run lint` | Runs ESLint |

## Configuration

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | The API, including `/api` |
| `VITE_STORE_URL` | The customer store, where legal documents are published. Unset, an `admin.<domain>` address assumes `store.<domain>` |
| `VITE_SENTRY_DSN` | Error reporting; nothing is reported when empty |
| `VITE_SENTRY_ENVIRONMENT` | How Sentry labels this deployment's errors: `staging` on the demo, `production` on Render. Unset, the build mode |
| `SENTRY_AUTH_TOKEN` | Build only, never in the bundle: a Sentry organization token. With it, the build uploads its source maps so errors show the real file and line, then deletes them from the output. Without it the build is unchanged |

Every `VITE_*` value is compiled into the public bundle. `.env` is gitignored.

## Admin accounts

There is no sign-up screen, and the API refuses to register an admin. Create one from the API repo:

```bash
node scripts/create-admin.mjs "Full Name" email@company.com
```

## Layout

```ts
src/
  pages/        One file per screen
  components/   Grouped by screen: orders, partners, earnings, settings, layout
  state/        Live notifications
  utils/        API client, auth, status labels, downloads
  test/         Unit tests
```

## Things worth knowing

- **Profit** is what the customer paid, less tax, shipping cost, partner cost and the Stripe fee. It is marked "est." until the order ships, because partners are paid on shipment.
- **Payouts** move in steps: Awaiting review, Approved, Paying, Paid (or Rejected, or Failed and retried). A rejected payout frees its jobs for a new one. Paying sends the money to the partner's Stripe balance once, then to their bank; when the bank refuses it, Try payment again repeats only the bank step, and the payout can no longer be rejected, since that would pay its jobs twice. Each Friday the API drafts payouts and the admins are notified.
- **Status labels** are the admin's own words for the stored statuses (`utils/orderStatus.ts`): Unassigned, Assigned, Printing, Ready to Ship, Shipped, Completed, Cancelled.
- **An order can hold several sheets.** The order page has a switcher; contents and preview follow the selected sheet.
