# Space Transfers Admin

The admin console for Space Transfers, a marketplace for DTF (direct-to-film) gang sheets. The business uses it to watch orders, manage print partners, set prices and see what it earns.

It talks to the API in `space-transfer-server`. Customers use `space-transfers`, and print partners use `space-transfer-printer`.

## What an admin can do

- **Home.** Revenue, order counts and recent orders for a chosen period.
- **Orders.** Every order with its region, partner, status, amount and profit. An order's page shows the customer, each sheet's contents and preview, the timeline, the assigned partner and the financials, and downloads the customer's invoice.
- **Fulfilment Partners.** The partner list, each partner's details and performance, and manual order assignment.
- **Approvals.** Approve or reject partners who signed up in the printer portal.
- **Earnings.** Revenue, partner cost, margin and what has been earned, with revenue by region.
- **Settings.** Retail price, sheet size, shipping rates, tax, the rush fee, partner pay, the assignment rule, partner job limits and the SLA.
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

Every `VITE_*` value is compiled into the public bundle. `.env` is gitignored.

## Admin accounts

There is no sign-up screen, and the API refuses to register an admin. Create one from the API repo:

```bash
node scripts/create-admin.mjs "Full Name" email@company.com
```

## Layout

```
src/
  pages/        One file per screen
  components/   Grouped by screen: orders, partners, earnings, settings, layout
  state/        Live notifications
  utils/        API client, auth, status labels, downloads
  test/         Unit tests
```

## Things worth knowing

- **Profit** is what the customer paid, less tax, shipping cost, partner cost and the Stripe fee. It is marked "est." until the order ships, because partners are paid on shipment.
- **Status labels** are the admin's own words for the stored statuses (`utils/orderStatus.ts`): Unassigned, Assigned, Printing, Ready to Ship, Shipped, Completed, Cancelled.
- **An order can hold several sheets.** The order page has a switcher; contents and preview follow the selected sheet.
