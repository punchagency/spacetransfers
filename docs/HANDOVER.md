# Handover

The state of Space Transfers when the original developer, Victor Odoh, handed it over on 9 November 2026.

## In short

All four apps are built, tested and running on a demo server with the client's own test accounts: Stripe in test mode, EasyPost with a test key, Resend, Cloudflare R2, MongoDB Atlas and Sentry. The demo has taken real test orders through every step. A customer uploads artwork and pays by card. The order is assigned to a partner, who accepts, prints and buys a label. The parcel is tracked to delivery and the partner's earnings are drafted into a payout.

Production on Render is fully described in [render.yaml](../render.yaml) but has not been created yet. It is waiting on four things from the client: the domain, the filled-in legal texts, a Google Cloud project and an Anthropic key. Once those arrive, launch is the ordered list under "Deploying" in the [API README](../space-transfer-server/README.md#deploying).

## Where everything is

| What | Where |
| --- | --- |
| Code | This repository. It holds the four apps that used to be separate repos, with their full history |
| The old repos | `punchagency/space-transfer-server`, `space-transfers`, `space-transfers-admin`, `space-transfer-printer`. Archive them once production is live; don't delete them |
| Production | Render, from `render.yaml`. Not created yet |
| Demo | `store.`, `admin.`, `printer.` and `api.stdemo.victoronojaodoh.com`, on Victor's own server. Temporary; see [The demo](#the-demo) |
| Error reports | Sentry organization `space-transfers`: projects `space-transfers-api`, `-store`, `-admin` and `-partner` |
| Go-live checklist for the client | <https://claude.ai/artifact/9AmTbipd7aoftYeT34gmcJ> (legal, domain, Google, Anthropic, running costs) |

## What is built

Each app's README lists its features. The parts with the most logic behind them:

- **The sheet builder.** Uploads in 12 formats are converted in the browser. Images are trimmed, checked for resolution and see-through areas, and arranged by hand or by auto-nest. AI edits run through Gemini, and backgrounds are removed in the browser. Signed-in customers' sheets save automatically.
- **Pricing and checkout.** The server prices everything: roll width times length, with a minimum length. Shipping is quoted live from EasyPost, and the address is checked by the carrier. Card payment goes through Stripe, and the server verifies the payment before an order exists.
- **Fulfilment.** Orders are assigned to a partner automatically, in the customer's region first. Status only moves forward. Labels are bought from the partner's address, and tracking completes the order. There is an SLA monitor, reprints and cancellation requests.
- **Money.** Admins can refund in part or in full. Profit is worked out per order. Partners are paid weekly through Stripe Connect, but only after an admin approves and pays each payout.
- **Problems and disputes.** Customers report problems with photos. The admin holds separate conversations with the customer and with the partner, and settles a report with a refund, a reprint or an explanation.
- **The rights check.** Every image is screened for other people's brands, characters and works: at upload, on AI edits, before payment and when the order is saved. Customers dispute a result with proof, and an admin decides with a written reason. A customer with three rejected disputes is flagged under the repeat-infringer rule. Partners can hold a job over a rights concern.
- **Accounts and security.** Customers can have up to four sub-accounts and can sign in with Google. Passkeys are optional for customers and partners and required for admins. Session tokens are versioned, so a password change signs every device out. Sign-in is rate limited. Each app has a strict content security policy.
- **Legal.** The Terms of Service (with a part for partners), Privacy Policy and Content Policy are versioned and edited in the admin console. Sign-up can't be completed until each one has been scrolled to the end. The server records the versions accepted, when each was read, and the sign-up's IP address and browser.
- **Customers' data.** A customer can download everything held about them and close their account. Partners can close theirs.
- **Operations.** Encrypted nightly backups with a restore drill, background jobs reported to Sentry, and a check that reports any payment that has no order.

Test suites at handover: API 808 tests, store 441, admin 71, partner portal 56. All pass from a clean clone, and the API's Dockerfile builds.

## What has not been proved live

These are written and unit-tested, but have never run against the real service:

- **Google Cloud Vision and Claude in the rights check.** The demo has neither key, so only the keyless layers (file metadata, the blocked-image fingerprints and the watch list) have run live. The Vision and Claude layers are tested against recorded response shapes. Once the keys are set, upload a well-known logo and a cartoon character and confirm both are caught.
- **Live money.** Everything has run in Stripe test mode only. Stripe Connect onboarding and card checkout work. The Connect webhook is registered on the client's test account, but no event has been delivered yet. The first proof will be a partner finishing onboarding. No payout has yet reached a real bank.
- **Real postage.** Labels and tracking have only used EasyPost's test mode, where every parcel reaches "delivered" by itself within minutes.
- **Google sign-in and Drive export on a real domain.** They need the OAuth client, which needs the domain.
- **Production load.** Print exports were measured on the demo: a dense 100in sheet section peaks near 2.3 GB of memory. That is why the launch plan is Render Pro (4 GB) with one export at a time.

## What's left before launch

**From the client** (the go-live checklist above walks them through it):

1. **Legal.** In the admin console under Legal documents, fill in every [bracketed] detail, publish, and have a lawyer review all three documents. The brackets are: company legal name, business address, state and county for governing law, the support and privacy emails, and the DMCA agent's name, address, email and phone. Register the DMCA agent at dmca.copyright.gov.
2. **Domain.** GoDaddy delegate access for whoever sets up DNS, and the chosen addresses. Suggested: the store on the main domain, with `admin.`, `partners.` and `api.` in front of it.
3. **Google Cloud project** with billing, holding the Cloud Vision key, the Gemini key and a Web OAuth client.
4. **Anthropic API key**, with a monthly spending limit set in the Anthropic console.

**Then the developer** follows "Deploying" in the API README. Steps 1 to 11 run from the database through to the switch to live keys.

**Do these on the final domain.** Admin passkeys are bound to the admin console's hostname. `R2_PUBLIC_BASE_URL` is written into every stored file's address in the database. Resend needs DNS records on the sending domain. Create the real admin accounts only once the domain is final.

## Open decisions

None of these blocks launch. Each needs an owner to decide.

| Question | Now | Note |
| --- | --- | --- |
| Keep the legal acceptance record when a customer closes their account? | It is deleted along with the account | For defensibility you may want to keep who accepted which version and when. That means a small change in `services/accountData.service.ts`, and the Privacy Policy's retention section must say so |
| Parcel weight per square foot | `packaging.weightPerSqFtLb` = 0.08 lb, never weighed | Weigh a real packed sheet and set it in admin Settings. It affects shipping quotes |
| Which carriers to quote | All carriers on the EasyPost account; the cheapest wins | Set `EASYPOST_CARRIERS` to restrict it |
| Claude model for the rights check | `claude-opus-5-5`, the most thorough | `RIGHTS_CLAUDE_MODEL` switches it. A lighter model costs about a fortieth as much, with fewer catches |
| Suspending repeat infringers | The site flags a customer after three rejected disputes. It does not suspend them | A person on the team decides |
| Who reviews rights disputes and reports | Any admin | Name someone, and check Rights and Issues daily |

## Accounts and access

Everything should end up in the client's name. "Victor" means access that was given to the outgoing developer and should be removed or handed on.

| Service | Belongs to | Developer access to remove or pass on |
| --- | --- | --- |
| GitHub | The client's organization (this repo) | Victor's membership |
| Render | Client | Victor, if invited |
| MongoDB Atlas | Client | Victor's database users and any network-access entries for his addresses |
| Stripe | Client | Victor's team membership. The test-mode Connect webhook points at the demo: delete it when the demo goes |
| EasyPost | Client | The test-mode webhook points at the demo: delete it when the demo goes |
| Resend | Client | Victor, if invited |
| Cloudflare R2 | Client | API tokens made for the demo: roll them once production has its own |
| Sentry (`space-transfers`) | Set up by Victor | **Transfer ownership to the client** (Settings → Members: make the client Owner, then remove Victor). Make a new organization token for source maps; the demo's isn't to be reused |
| GoDaddy | Client | Delegate access, once DNS is done |
| Google Cloud | Client | Editor role, once the setup is checked |
| Anthropic | Client | None |

Secrets:

- **Production secrets live only in Render's Environment tabs.** Every secret in `render.yaml` is `sync: false`, so none is in git. The Sentry DSNs in `render.yaml` are not secrets: a DSN only lets an app send error reports.
- **`BACKUP_ENCRYPTION_KEY` must also be kept outside Render**, in the client's password manager. Without it no backup can be read.
- **Rotate everything the demo used before production.** Production gets fresh R2 tokens, a fresh JWT secret and its own webhook secrets.

## The demo

The demo runs in Docker on Victor's server, under his personal domain. It uses the client's test accounts and a staging database. It was always meant to be temporary, and nothing in the code depends on it. When it is switched off:

- **The staging database and the R2 bucket stay.** They are the client's. The staging data is test data and can be dropped. R2 holds the demo's uploaded test artwork and four encrypted backups from October under `backups/`. Delete those, or keep a copy of the demo's backup key, which only Victor holds.
- **Delete the demo's webhooks.** The Stripe test-mode Connect webhook and the EasyPost test-mode webhook both point at `api.stdemo.victoronojaodoh.com`.
- **Look elsewhere for a staging environment.** If you want one after launch, a second Render Blueprint pointed at a separate database works. Give it its own database: the background jobs have no off switch, so two APIs on one database run every job twice.

## Leftovers from before

- **An older deployment by the previous developer.** An API on Heroku and Vercel projects for the three front ends run much older code. They are not used. The `vercel.json` files stay because their security headers are mirrored in `render.yaml`: change both together.
- **Cloudinary.** Files once lived there. The staging database still points at some, but nothing writes there, and production starts with an empty database.
- **ShipStation.** EasyPost replaced it. `node dist/tools/shipping.js migrate` moves old orders off the ShipStation fields. A fresh production database doesn't need it.

## Known limitations

- **One API instance.** Background jobs have no lock. Live updates (Server-Sent Events) and rate limits are held in memory. Two instances would run every job twice and split live updates between them. Scaling out needs a job lock and a shared store such as Redis first.
- **Free plan until launch.** The API sleeps after 15 idle minutes, and its jobs stop while it sleeps. It has 512 MB of memory and no disk, so a long print export runs out of memory. See "Until launch" in the API README.
- **US only.** Addresses, shipping, tax and the Terms assume the United States.
- **Formats.** EPS and pre-PDF Illustrator files are refused with guidance. Everything else is converted to PNG in the browser.
- **The store is on React 18; the admin and partner portal are on React 19.** The store also runs an older Vitest. It works, but upgrade them together on purpose rather than by accident.

## A new developer's first week

1. Read [DEVELOPMENT.md](DEVELOPMENT.md) and get all four apps running against a database of your own.
2. Read [DECISIONS.md](DECISIONS.md). Most rules that look odd in the code were the client's explicit choice.
3. Place an order end to end locally with a Stripe test card (4242 4242 4242 4242). Sign in as a partner, accept the order, print it and request a label. Then look at the order in the admin console.
4. Read [OPERATIONS.md](OPERATIONS.md) before touching production.
