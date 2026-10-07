# Space Transfers Store

The customer-facing app for Space Transfers, a marketplace for DTF (direct-to-film) gang sheets. A customer uploads artwork, arranges it on a sheet the width of the print roll, pays, and follows the order.

It talks to the API in `space-transfer-server`. The business side lives in `space-transfers-admin`, and print partners use `space-transfer-printer`.

## What customers can do

- **Build a sheet.** Upload PNG, JPG, PDF, SVG, AI, PSD, TIFF, WebP, AVIF, HEIC, GIF or BMP. Everything is converted in the browser and trimmed to its artwork. A PDF page that is only a picture is rendered at that picture's real resolution, so a small photo on a large page is flagged as low resolution instead of passing at 300 DPI.
- **Check the artwork.** Images below 300 DPI are outlined in amber, and images with fades or see-through areas in orange. The top bar counts each kind in a chip of the same colour; clicking a chip steps through the affected images.
- **Remove backgrounds.** A plain background of any colour is removed exactly, in the browser, by colour — including, by default, inside letters and between lines (the Clear Enclosed Background setting). Anything else goes to an in-browser AI model that cuts out the subject. See `artboard/lib/utils/bgRemover.ts`.
- **Arrange it.** Drag, resize, rotate, flip, lock, duplicate and group. Auto-nest packs the sheet as short as possible.
- **Get warned.** Images under 300 DPI and artwork with fades or see-through areas are flagged, because DTF cannot print them as shown.
- **Edit with AI.** Board commands such as "12 copies" or "make it 4 inches wide" run in the browser. Image edits go to the API.
- **Save automatically.** Signed-in customers' sheets are saved as they work and reopen from the gallery. The store opens on the sheet they last had open.
- **Check out.** The cart holds one line per saved sheet, as it was when it was added. Checkout validates the address inline, prices shipping for the address, and takes a card through Stripe.
- **Share an account.** A main account can add up to four sub-accounts, switch between them, and remove one. Removing deletes its sign-in and saved sheets; past orders stay on record, and an account with orders in progress cannot be removed.
- **Follow orders.** Order history shows status, details and the invoice, and can reorder a past order. A cancelled order shows what was refunded.

## Stack

React 18, TypeScript, Vite, Tailwind CSS, Stripe Elements. Tests run on Vitest.

## Getting started

```bash
npm install
cp .env.example .env    # then fill it in
npm run dev             # http://localhost:5000
```

The API must be running; see `space-transfer-server`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Runs the tests in watch mode (`npx vitest run` for a single pass) |
| `npm run build` | Type-checks and builds to `dist/` |
| `npm run preview` | Serves the built app |

## Configuration

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | The API, including `/api` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key; card fields do not render without it |
| `VITE_GOOGLE_CLIENT_ID` | Google sign-in; the option is hidden when empty |

Every `VITE_*` value is compiled into the public bundle. Never put a secret in one. `.env` is gitignored; `.env.production` holds only the production API URL.

## Layout

```ts
src/
  components/
    Editor.tsx       The page: board, cart, saving, sign-in, order history
    Artboard.tsx     The sheet and everything on it
    Header.tsx       Sheet name, save state, price, cart
    Sidebar.tsx      Sheet settings and the gallery
    artboard/        Board features (items, AI, canvas) and their logic
    checkout/        Cart, address, shipping method, payment and review steps
    modals/          Checkout, sign-in, account, order history and details
  lib/utils/         API client, auth, pricing, cart sync, checkout rules
  config/            Board constants (DPI threshold, upload formats)
  test/              Unit tests
```

## Things worth knowing

- **Prices come from the API.** The store shows an estimate until the address is entered, then the server's quote, which is what the card is charged.
- **The cart holds the version that was added.** A cart line belongs to one saved sheet, but keeps the sheet as it was when the customer added it. Later edits are saved to the sheet and reach the cart only through Update Cart; Save as a new sheet turns the edits into a separate sheet and puts the original back to its cart version. A line whose sheet has moved on is marked `sheetChanged` and says so in the cart.
- **Artwork is uploaded, never embedded.** Sheets and orders hold links to stored images. A sheet whose artwork has not finished uploading cannot be saved or ordered.
- **Images must load with CORS.** The editor reads pixels for cropping, DPI and transparency checks, so the storage bucket needs a CORS policy for this origin (see the API's `.env.example`).
- **The store is for customers only.** Partner and admin accounts are signed out here.
