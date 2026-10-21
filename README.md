# Space Transfers Printer Portal

The app print partners use to fulfil Space Transfers orders. Space Transfers is a marketplace for DTF (direct-to-film) gang sheets: customers design and pay in the store, and a partner prints and ships each order.

It talks to the API in `space-transfer-server`. Customers use `space-transfers`, and the business uses `space-transfers-admin`.

## What a partner can do

- **Sign up.** A new partner registers with a business address and waits for an admin to approve the account.
- **Home.** Active jobs, urgent jobs and what is due next.
- **Jobs & Orders.** Every assigned job by stage, with the next deadline: accept by, then print by.
- **Work a job.** Accept and start it, preview each sheet, export the print file, download the customer's original images, request the shipping label and confirm pickup.
- **Answer a cancellation request.** When a customer asks to cancel, the job is tagged Cancel requested and put on hold until the partner answers. Accept cancels the order and refunds the customer, and the job isn't paid. Decline keeps it going, and the customer is shown the reason. Free reprints are tagged with the order they replace, and marked Unpaid reprint when Space Transfers chose not to pay for one.
- **Availability.** Pause and resume new work.
- **Earnings & Payouts.** What each job pays and what has been paid out.
- **Profile and Settings.** Business details, notification preferences and password.
- **Close the account.** Settings → Close your account, once no job is in progress, no customer report on their jobs is open and nothing is still owed to them. It asks for the password and signs them out everywhere. Their business name, email, address, jobs and payouts are kept for accounting; they can re-apply later with the same email.

## Stack

React 19, TypeScript, Vite, Tailwind CSS. Tests run on Vitest.

## Getting started

```bash
npm install
cp .env.example .env    # then fill it in
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
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client for "Download to Google Drive" |
| `VITE_STORE_URL` | The customer store, where the legal documents are published. Unset, a `printer.<domain>` address assumes `store.<domain>` |
| `VITE_SENTRY_DSN` | Error reporting; nothing is reported when empty |

Every `VITE_*` value is compiled into the public bundle. Never put a secret in one; a client secret does not belong in this app. `.env` is gitignored.

For Google Drive, the portal's address must be listed under Authorised JavaScript origins on the Google OAuth client. Without it Google refuses with `origin_mismatch`.

## Layout

```ts
src/
  pages/        One file per screen
  components/   Grouped by area: orders, print, drive, profile, settings, layout
  state/        Live notifications
  utils/        API client, auth, dates, status wording, Drive upload
  test/         Unit tests
```

## How a job moves

| Partner sees | Meaning | Next step |
| --- | --- | --- |
| Pending Review | Assigned, not started | Accept & Start |
| In Progress - Printing | On the press | Print Shipping Label |
| Print Shipping Label | Printed; label requested | Confirm the package is ready for pickup |
| Order Shipped | Waiting on the carrier | None |
| Completed | Delivered | None |

Every move is forward-only and asks for confirmation. Cancel Job hands the job back to Space Transfers to reassign; it does not cancel the customer's order. When a customer reports a problem and Space Transfers asks about it, the question appears at the top of the job page with a reply box; the partner sees only that conversation, not the customer's messages or photos. Orders with an open question are listed in a banner on Home and on Jobs & Orders whatever their status, tagged "Reply needed" or "Problem reported" in the lists, and counted beside Jobs & Orders in the menu while a reply is owed. A job is marked Completed by the carrier's delivery confirmation, never by hand.

## Things worth knowing

- **An order can hold several sheets.** The job page has a sheet switcher, and each sheet is exported and printed separately. Files are named `…_sheet1of2.png`.
- **Print files** are transparent PNGs at 300 DPI. Very long sheets download as a zip of parts.
- **Earnings** become payable when a job ships. Each Friday payable jobs are put forward as a payout, which Space Transfers reviews and pays; nothing is paid automatically.

## Security

Partners can add a passkey as a second sign-in step in Settings. A suspended account is signed out on its next request. The headers and content security policy for production are in `vercel.json`.
