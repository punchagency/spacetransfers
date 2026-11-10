# Decisions

The product rules that look arbitrary in the code, with the reason behind each. Most were the client's explicit choice. Change one only on purpose, and update this page when you do.

## Sheets and pricing

- **A sheet is billed as roll width × length, with a minimum length** (23.5in wide, 12in minimum; both in admin Settings → General, "Sheet size"). Not the area of the artwork: a single 6×10in graphic uses a whole 23.5in-wide strip of film, and billing only the artwork undercharged sparse sheets about four-fold. The server bills the greater of the length the store claims and the length the artwork actually reaches. Shipping uses the same billable area, because the parcel holds the roll, not the printed part.
- **The print file is as long as the artwork.** A sheet billed at the minimum length is not padded out to it. Sheets longer than 100in are split into parts between graphics.
- **Auto-nest turns any piece when that makes the sheet shorter,** and keeps the shorter of two packing strategies, so auto-nest can never make a board longer. `N` toggles it.
- **Spacing defaults to 0.25in.** Spacing, margin and auto-nest are saved per sheet. View settings are saved per browser.

## The cart

- **A cart line is the sheet as it was when it was added** (the client's rule from October 2026). Edits autosave to the sheet but not to the cart. The header's button becomes **Update Cart**, with a second choice, **Save as a new sheet**, which keeps the edits as a separate sheet and puts the original back to its cart version. A line whose sheet has moved on says so in the cart. The client rejected two earlier versions: one where edits always updated the cart, and one with a notice that the sheet was in the cart.
- **One line per sheet. Sheet names are unique per customer.** The store reopens the sheet the customer last had open.

## Artwork checks

- **Everything is converted to PNG in the browser before upload,** whatever the format, so every edit behaves the same for every format. The server refuses PDF and SVG artwork, because it can't draw them reliably. EPS and pre-PDF Illustrator files are refused with guidance.
- **Below 300 DPI is flagged in amber.** A PDF page that is only a picture is judged by the picture's own resolution.
- **See-through artwork is flagged in orange.** The rule: alpha between 8 and 248 over at least 1% of the visible area, not counting anti-aliased edges, sampled so halftones don't count. Over 50% transparent "won't print"; partly transparent "prints solid, stronger than on screen". DTF prints white ink under colour, so partial transparency doesn't print as it looks on screen. Raising `TRANSPARENCY_CHECK_VERSION` re-checks images whose verdict is cached.
- **Flags belong to the image, not the board item.** They survive edits, reopening a sheet and undo.

## The rights check

Built at the client's request; where the client left the detail open, it follows common industry practice.

- **A confident match blocks at upload. An uncertain one is marked and stops checkout** until it is removed or cleared.
- **Checked again before payment and again when the order is saved,** on every printed image *and* the original it was made from. A crop or background removal strips the file's copyright details. A stock photo once got through in testing because only the edited copy was checked.
- **Every admin decision needs a written reason,** recorded with the admin's name. An approval clears only the findings it names, for that customer only. A rejection blocks the image for every customer unless the admin unticks that. Three rejections flag the customer as a repeat infringer; suspending them is a person's decision.
- **Customers confirm they have the rights** to their artwork before ordering. Partners can put a job on hold over a rights concern.

## Fulfilment

- **Automatic assignment prefers the customer's own state,** then the nearest partner in their region, then the least loaded, then the best rated. If the whole region is busy, the next region is tried.
- **Partners can only move a job forward, and can't cancel an order.** A partner who can't do a job hands it back to be reassigned. A customer's cancellation request goes to the partner, who accepts or declines with a reason.
- **Completed is set only by the carrier's delivery confirmation,** because it makes the job payable.
- **Shipping quotes start from the partner likely to ship.** When none serves the region, they start from Lebanon, Kansas, the geographic centre of the contiguous US. Labels always come from the partner's own business address. The Lebanon address only shapes quotes, so it can never end up on a label as a return address.
- **No carrier list:** every carrier on the EasyPost account is quoted and the cheapest wins.

## Money

- **No money moves without an admin.** Each Friday the API drafts payouts for review; an admin approves and then pays each one. A payout whose money has left can't be rejected, because rejecting frees its jobs to be paid again.
- **Refunds and cancellations go through Stripe first.** The order changes only once Stripe accepts.
- **A free reprint pays the partner only if the admin says so,** chosen on every reprint. Unpaid reprints count $0 in earnings, payouts and profit.
- **Card only.** The server verifies every payment with Stripe (succeeded, this customer, the exact total) before an order exists.

## Accounts, security and legal

- **Admins must have a passkey.** Admin accounts are created only by script; nobody can register as one.
- **A password change or reset signs out every device,** through the token version.
- **Sign-up requires reading each legal document to the end** (the client's request in October 2026, for defensibility). The server refuses a sign-up without the read times, and records the versions, the times, the IP address and the browser. People who signed up earlier keep the versions they accepted and aren't asked again.
- **Legal texts live in the database** and are versioned by date. Every publish needs a note of what changed.
- **Closing an account keeps orders** for the business's records, and keeps any stored file an order uses. It is refused while an order is in progress or a report is open. A closed partner's record is kept for payouts and tax.
- **Sentry doesn't store IP addresses.**

## Infrastructure

- **One repository, four folders, no shared `package.json`.** Render builds each folder on its own, and a workspace would break each app's lockfile.
- **Render's free plan until launch, then Pro (4 GB) with a 20 GB disk.** Measured on the demo: a dense 100in section of a sheet at 300 DPI peaks near 2.3 GB. Render's Standard plan (2 GB) is too small, and one export at a time (`EXPORT_RENDER_CONCURRENCY=1`) keeps Pro safe.
- **Exactly one API instance.** The background jobs have no lock, and live updates and rate limits are in memory.
- **Email through Resend,** chosen by the client.
- **Backups are encrypted under a key of the business's own,** in addition to whatever the database host keeps.
