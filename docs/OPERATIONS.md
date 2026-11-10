# Operations

How to deploy, run and look after production. First-time setup, in order, is under "Deploying" in the [API README](../space-transfer-server/README.md#deploying). This page covers running it afterwards.

## Deploying a change

Merge to `main`. Render rebuilds each service whose folder changed. The API is healthy once `/api/health` answers 200, which needs the database, and only then does it take traffic. A failed build or health check leaves the previous version running.

- **To roll back,** redeploy an earlier commit from the service's page in Render, then revert the change in git so the next deploy doesn't bring it back.
- **Front-end settings are compiled in.** After changing a `VITE_*` value in Render, start a new deploy of that site. Changing the API's settings restarts the API.
- **A change to `render.yaml`** is applied from Render's Blueprint page, which shows what will change first.

## Settings

Every API setting is explained in [space-transfer-server/.env.example](../space-transfer-server/.env.example), and every front-end setting in its README. In production they live in each service's Environment tab in Render. Business settings (prices, sheet size, shipping rates, tax, partner pay, assignment, SLA) are edited in the admin console under Settings and take effect at once.

## Routine work

| When | What | Where |
| --- | --- | --- |
| Daily | Answer problem reports | Admin → Issues (the menu shows a count) |
| Daily | Decide rights disputes and partners' rights concerns | Admin → Rights (the menu shows a count) |
| Daily | Read notifications: payments with no order, failed labels, orders no partner could take, unanswered cancellation requests | Admin → the bell |
| As they arrive | Approve or reject partner applications | Admin → Approvals |
| Fridays | Review the drafted payouts, then approve and pay each one. Nothing is paid automatically | Admin → Payouts |
| Weekly | Look at new issues in Sentry for each project, `production` environment | Sentry |
| Monthly | Run the backup drill (below) | API Shell |
| When legal text changes | Edit, then publish with a note of what changed | Admin → Legal documents |

## Admin accounts

- **New admin.** `node scripts/create-admin.mjs "Name" email@company.com`, from the API's Shell in `/app`. On the free plan, run it from a laptop with `MONGO_URI` set (see the API README). It prints a password once: send it securely. The new admin registers a passkey at first sign-in.
- **An admin who lost their passkey** signs in with one of their recovery codes and registers a new one. If they have no codes left, another admin resets their passkeys under Profile → Security, giving a reason. All admins are told.
- **Domain change.** Passkeys belong to the console's address, so after moving the admin console every admin signs in with a recovery code and registers again.

## Backups

At 03:00 UTC every collection is copied, gzipped, encrypted with `BACKUP_ENCRYPTION_KEY` and stored under `backups/<date>/` in `BACKUP_R2_BUCKET`. The last 30 are kept. A failure is reported to Sentry and to the admins. MongoDB Atlas makes its own snapshots too on paid clusters; these backups are a second copy, under your own key.

```bash
node dist/tools/backup.js list                          # what is stored
node dist/tools/backup.js backup                        # take one now
node dist/tools/backup.js drill                         # restore the latest into a scratch database, compare, drop it
node dist/tools/backup.js restore <date> <database>     # restore into a new database (it refuses the live one)
```

**To recover from a backup,** restore it into a new database beside the live one. Check the data there, then point `MONGO_URI` at it and restart the API.

**The key is the only way to read a backup.** Keep a copy in the company's password manager, not only in Render.

## Monitoring

- **Sentry.** Four projects, one per app. Each deployment reports as `production` or `staging`, so filter by environment. Background job failures are tagged with the job's name. IP addresses are not stored. Front-end stack traces are readable when `SENTRY_AUTH_TOKEN` is set on the static sites; without it they show minified code.
- **Render.** The API's Logs and Metrics tabs. Memory is the figure to watch: print exports use the most.
- **Health.** `GET /api/health` answers 503 while the database is unreachable.

## Webhooks

| From | To | Set up with | Run it again when |
| --- | --- | --- | --- |
| Stripe (Connect events: onboarding, payouts) | `/api/payouts/webhook` | `scripts/setup-stripe-webhook.mjs` (prints the signing secret once; set it as `STRIPE_WEBHOOK_SECRET`) | The API address changes, or you switch between test and live keys |
| EasyPost (tracking) | `/api/webhooks/easypost` | `scripts/setup-easypost-webhook.mjs` | The API address changes, or you switch between test and production keys |

Webhooks belong to a key's mode, so moving to live keys needs both scripts run again with the live keys.

## Going from test to live

1. In Stripe, swap `STRIPE_SECRET_KEY` on the API and `VITE_STRIPE_PUBLISHABLE_KEY` on the store for the live keys. Run the Stripe webhook script with the live key and set the new `STRIPE_WEBHOOK_SECRET`. Redeploy the store.
2. In EasyPost, swap in the production key, set `EASYPOST_LABELS_ENABLED=true` and run the EasyPost webhook script again. From then on every label costs real postage.
3. Place one real order with a real card to an address you can receive at, and follow it to delivery. Then refund it from the admin console.

## When something looks wrong

Most failures here look like bugs but are a missing or wrong setting. Check these first.

| What you see | Likely cause |
| --- | --- |
| Uploads fail with "Artwork storage is not configured" | An `R2_*` setting is missing; all five are needed, including `R2_PUBLIC_BASE_URL` |
| Images upload but cropping, DPI, background removal or the transparency check fail in the browser | The R2 bucket's CORS rule doesn't list that front end's address |
| Images uploaded but don't display | `R2_PUBLIC_BASE_URL` points at the account's S3 endpoint instead of the bucket's public address |
| A file seems missing from R2 when fetched by a script | R2's public address refuses some default user agents (for example Python's). Try curl before concluding it's gone |
| Checkout has no card fields | The store was built without `VITE_STRIPE_PUBLISHABLE_KEY`. Set it and redeploy the store |
| "Card payments are unavailable" | `STRIPE_SECRET_KEY` is missing on the API |
| Payouts stay "Paying"; a bank's refusal never shows up | Stripe's events aren't reaching the API: `STRIPE_WEBHOOK_SECRET` is missing or wrong, or the webhook points at an old address |
| No emails arrive | `RESEND_API_KEY` is missing, or the sending domain isn't verified in Resend. The API logs every email it couldn't send |
| Shipping shows flat rates | No EasyPost key, or EasyPost failed for that request; the order records why |
| Labels fail | `EASYPOST_LABELS_ENABLED` is off, the partner has no business address, or EasyPost refused (the partner sees the reason, and the admins are told) |
| Orders never reach Shipped or Completed | The EasyPost webhook isn't registered for this key's mode, or the API was asleep (free plan). The poller catches up every 30 minutes while it is awake |
| AI image edits are missing | No `GEMINI_API_KEY`, or billing is off on the Google project (every Gemini image model's free limit is zero) |
| No "Sign in with Google" or Drive buttons | `VITE_GOOGLE_CLIENT_ID` wasn't set when the site was built |
| Google says `origin_mismatch` | The site's address isn't an authorised JavaScript origin on the OAuth client |
| An admin is stuck on "Set up a passkey" | Expected: admins need one. After a domain change everyone registers again |
| "Too many attempts" at sign-in | 10 sign-ins per 15 minutes per address. It clears by itself, or on an API restart |
| A published legal change isn't showing | Public reads are cached for up to 60 seconds |
| The API restarts during a print export | It ran out of memory: the free plan's 512 MB isn't enough for long sheets. Launch on Pro with `EXPORT_RENDER_CONCURRENCY=1` |
| Background jobs didn't run overnight | On the free plan the API sleeps after 15 idle minutes, and its jobs stop with it |

### Payment-specific situations

- **"Payment with no order."** A customer was charged but no order was saved; they may have closed the page mid-checkout. Find the payment in Stripe from the notification. Either refund it in Stripe, or contact the customer.
- **A payout failed at the bank.** The money is in the partner's Stripe balance. The partner is asked to fix their bank details; then **Try payment again** on the payout repeats only the bank step. Don't reject it: its money has already moved.
- **A refund.** Use the order's page in the admin console, not the Stripe Dashboard, so the order and its profit figures record it.

## Customers' and partners' data

Customers download their data and close their account themselves in the store's Account Settings. Partners close theirs in the portal's Settings. The rules (what is refused, what is deleted, what is kept for the business's records) are in the API README under "Customers' data" and "Partners closing their account". For a data request by email, ask the customer to use Account Settings, which proves they own the account.

## Removing test data

Take care. Test orders cloned from a real order share its stored files, so deleting their files deletes the real order's artwork.

- Do test runs as a signed-in customer you created for the purpose, never as a guest.
- Refund paid test orders from the admin console before deleting them.
- Delete files only when nothing else points at them. Delete a customer's report photos by their `issues/<userId>/` prefix.
- Admin notifications are stored per admin. Delete those for a test order (`meta.orderId`) along with it.
