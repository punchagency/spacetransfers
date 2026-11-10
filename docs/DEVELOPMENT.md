# Development

## Setting up

You need Node 26 (what the code and the Dockerfile are tested on), npm, and a MongoDB database of your own. A free Atlas cluster works, or `mongod` locally.

```bash
# The API
cd space-transfer-server
npm install
cp .env.example .env      # set MONGO_URI and JWT_SECRET (32+ characters) at least
npm run dev               # http://localhost:4000

# Each front end, in its own terminal
cd space-transfers         && npm install && cp .env.example .env && npm run dev   # http://localhost:5000
cd space-transfers-admin   && npm install && cp .env.example .env && npm run dev   # Vite prints the address
cd space-transfer-printer  && npm install && cp .env.example .env && npm run dev
```

The front ends' `.env.example` already point `VITE_API_URL` at `http://localhost:4000/api`. Outside production the API accepts any `localhost` origin, so CORS needs no setup locally.

**Use your own database.** Never point a local API at staging or production. The background jobs (payouts, tracking, assignment, backups) have no off switch, so two APIs on one database run each job twice.

### Accounts to test with

- **Customer.** Sign up in the store. You must scroll each legal document to the end before the boxes tick. With no Resend key no email is sent; the API logs each one's recipient and subject instead.
- **Partner.** Sign up in the partner portal, then approve the partner in the admin console under Approvals.
- **Admin.** Run `node scripts/create-admin.mjs "Your Name" you@example.com` in `space-transfer-server`. It prints a password once. Admins need a passkey. Register one in the browser (Chrome's DevTools → WebAuthn can create a virtual one), or set `ADMIN_PASSKEY_REQUIRED=false` in your local `.env`. That setting is honoured on a developer's machine only.
- **Password resets without a mailbox.** `EXPOSE_RESET_TOKENS=true` returns the token in the response, on a developer's machine only.

### Services you can leave out

Everything except MongoDB is optional locally; the API README's "Configuration" table says what each missing key turns off. To exercise them:

- **Stripe.** Test keys from a Stripe account in test mode, with card 4242 4242 4242 4242, any future date and any CVC. The store also needs `VITE_STRIPE_PUBLISHABLE_KEY`.
- **EasyPost.** A test key (`EZTK…`) gives real rates and simulated labels and tracking, free. Set `EASYPOST_LABELS_ENABLED=true` with it. Test parcels reach "delivered" by themselves within a few minutes.
- **R2.** Without it, uploads fail with 503. Use a separate bucket for development, with the CORS rule from `.env.example` allowing your localhost origins.
- **The rights check without keys.** Add a blocked image or a watch term in the admin console under Rights. That gives a "blocked" or "held" verdict with no Vision or Claude key.

## Tests

| App | One pass | Count at handover |
| --- | --- | --- |
| API | `npm test` (Node's test runner through `tsx`) | 808 |
| Store | `npx vitest run`. Plain `npm test` stays in watch mode and never exits | 441 |
| Admin | `npm test` | 71 |
| Partner portal | `npm test` | 56 |

Each app also has `npm run build`, which type-checks first, and the admin console and partner portal have `npm run lint`. Run the tests and the build of every app you touched before merging.

**Some API tests write print exports to `uploads/exports/`.** A stale cache there once hid a broken test fixture for weeks. If an export test passes locally but fails on a clean clone, delete `uploads/exports/` and run it again.

## Working on the code

### Rules that hold the system together

- **The server decides prices.** Nothing the browser sends is trusted for an amount. The store mirrors the pricing rules (`lib/utils/pricingRates.ts`) only so it can show an estimate. Change both together.
- **The three front ends must agree.** Status names, what a customer, partner and admin see about the same order, and the rules each enforces. When a change touches one app's view of an order, check the other two.
- **Status only moves forward.** `utils/partnerStatusRules.ts` is the single list of allowed moves. Completed comes only from the carrier.
- **Never pass an upstream 401 or 403 back as our own.** The front ends treat our 401 as an expired session and sign the user out. Answer 503 (not configured) or 502 (upstream failed) instead.
- **Fetch user-supplied URLs only through `fetchStoredArtwork`.** It is what stops the server from being used to fetch arbitrary addresses.
- **`VITE_*` values are public.** They are compiled into the bundle. A secret never goes in one.
- **Security headers live in two places.** They are in `render.yaml` (production) and each app's `vercel.json`, and the two must stay identical. The store's content security policy needs `blob:` and `'unsafe-eval'` in `script-src` for the in-browser background remover. Test a header change in a real browser.
- **Comments say what the code does and why,** not the history of how it got there. The history is in git.

### The parts most likely to bite

- **Image state on the board.** `originalUrl` and `assetId` are the upload and never change. `uncroppedUrl` is the current full image, updated by every pixel edit (`afterPixelEdit` in `imageState.ts`). `url`/`croppedUrl` is what is shown and printed. Code that rebuilds an image from `originalUrl` silently undoes the customer's edits.
- **The cart is frozen** until the customer updates it (see [DECISIONS.md](DECISIONS.md)). Never write board changes into a cart line except through Update Cart. Never rewrite a line on load.
- **The checkout modal stays mounted when closed** and keeps its step, so reopening it skips step 0. Any check that runs at step 0 must also run on later steps when the cart has changed. The rights check does this with `rightsClearedRef` in `CheckoutModal.tsx`.
- **Sheet bounds.** No item may sit outside the margin lines. Clamp positions to the margin, not to 0. `fitItemToPrintableArea` runs on every board change.
- **The print export must match the board.** Placement maths lives in one place on the server (`resolvePlacement`) and mirrors the board's `ArtboardItem`. If you change how an item is drawn on the board, change the export too, and compare a real export with the board.
- **Mongoose sub-documents lose fields when spread** with `{ ...doc }`. Convert with `.toObject()` first.
- **Guest uploads create no `asset` record,** so files a guest uploads have nothing pointing at them. Test uploads as a signed-in customer so they can be cleaned up.
- **The legal documents shown come from the database,** not from `config/legalSeed.ts`. The seed only fills an empty database. Public reads are cached for 60 seconds.

### Dependencies

- **`npm audit fix --omit=dev` removes devDependencies** (TypeScript, Vitest). Run `npm install` afterwards.
- **Pin versions that were released very recently.** The front ends pin Sentry's bundler plugins through an npm `overrides` entry for that reason.
- **The store is on React 18 and Vitest 1;** the admin console and partner portal are on React 19 and Vitest 4.

## Git and deploying

`main` is what production runs. Render deploys a service whenever a commit to `main` changes that service's folder. Work on a branch, open a pull request, and merge once the tests and builds pass. Each app keeps its own `package.json` and lockfile: install and run commands from inside its folder, not from the root.
