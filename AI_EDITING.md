# AI Editing Suite

Natural-language image editing for the artboard, powered by **Google Gemini** on
its free tier.

## Setup

1. Get a key at <https://aistudio.google.com/apikey>.
2. Add it to `space-transfer-server/.env`:

```bash
GEMINI_API_KEY=your_key_here
```

`GOOGLE_AI_API_KEY` is accepted as an alias, since that is the name AI Studio
shows on the key page.

### What is and is not free — read this before assuming

**Prompt understanding is free. Image editing is not.**

Verified against a live AI Studio key (July 2026):

| Model family | Job | Free tier |
| --- | --- | --- |
| `gemini-flash-latest` and other text models | prompt understanding / planning | ✅ generous free allowance |
| **every** Gemini image model | image editing | ❌ **`limit: 0`** — no free allowance at all |

Image models return HTTP 429 with a quota violation reporting `"limit": 0` on an
unbilled project. That is not an exhausted allowance — it is *no* allowance, and
it never clears with time. Enabling billing on the key's Google Cloud project is
what fixes it; edits then cost roughly $0.04 each.

Models confirmed to report `limit: 0` without billing: `gemini-2.5-flash-image`,
`gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`,
`gemini-3.1-flash-image-preview`, `nano-banana-pro-preview`.

**If you need image editing at zero cost**, configure the Cloudflare Workers AI
tier instead (10,000 neurons/day, no card):

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

### Model selection and rotation

Both jobs use a *candidate list*, not a pinned id, because Google retires model
ids on its own schedule — a retired id returns `404 "no longer available to new
users"`, which reads in logs like a broken integration rather than an expired
name. The text list leads with `gemini-flash-latest`, a moving alias: for a
parsing job like planning, tracking the current flash model automatically is
worth more than pinning a version.

Blocks are tracked **per model**, so one capped or retired model never disables
the others.

```bash
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image   # overrides the whole candidate list
GEMINI_TEXT_MODEL=gemini-flash-latest       # overrides the whole candidate list
```

An explicit override wins outright and disables the fallback chain — an operator
naming a model has a reason, and silently using a different one would hide it.

### Failure states

`classifyFailure` distinguishes four, because they need opposite handling and are
indistinguishable at the status-code level:

| State | Trigger | Pause | Recovery |
| --- | --- | --- | --- |
| `rate_limited` | 429, per-minute burst | 60s | automatic |
| `daily_cap` | 429, allowance used up | 30min | resets on Google's daily quota |
| `billing_required` | 429 with `"limit": 0` | 5min | **needs billing enabled** |
| `retired` | 404 "no longer available" | 6h | next model in the list |

`billing_required` is paused only 5 minutes despite needing human action —
deliberately shorter than the daily cap. The moment an operator enables billing
the model starts working and nothing tells the server, so a long window would
keep the feature dark *after* it was already fixed, which reads as the fix not
working. `resetGeminiBlocks()` clears every pause immediately.

A success on any model clears its block at once.

## Provider tiers

Requests fall through in order. Each tier is skipped, not failed, when it isn't
available — so a spent quota or a lapsed card degrades the feature instead of
breaking it.

| Order | Tier | Cost | Notes |
| --- | --- | --- | --- |
| 0 | **Browser (local)** | free | Background removal (WASM segmentation), colour removal, sticker borders. Never reaches the server. |
| 1 | **Gemini** | free | All instruction editing. Takes raw bytes — no staging upload. |
| 2 | Replicate (`flux-kontext-pro`) | ~$0.04/img | Used only if Gemini is capped or fails. |
| 3 | Cloudflare Workers AI | free tier | Last resort. |

`GET /api/customer/assets/ai-edit/capabilities` reports which tiers are live,
which intents they serve, and — when everything is dark — *why*
(`unconfigured` / `rate_limited` / `daily_cap` / `out_of_credit`).

## Endpoints

```
GET  /api/customer/assets/ai-edit/capabilities   readiness + live intents
POST /api/customer/assets/ai-edit                { url, prompt, intent, seed? }
POST /api/customer/assets/ai-edit/plan           { prompt, history[] } → ordered steps
```

The plan endpoint is text-only and returns in a second or two, so the client
calls it on every submit to decompose multi-step requests before any image work
starts. It never fails a request: no key, or an unusable answer, returns
`{ planned: false }` and the client proceeds on its own keyword classifier.

## Tools

Each is a canonical **intent**. Adding one starts at `AiIntentId` in
`space-transfer/src/components/artboard/lib/ai/types.ts`; the verb table,
completion copy and tuning map are exhaustive `Record<AiIntentId, …>`s, so the
type checker walks you through every place that needs wiring and a half-added
tool cannot compile.

| Intent | Served by | Notes |
| --- | --- | --- |
| `remove-bg` | browser → generative | WASM segmentation; keeps hair/fur detail and partial alpha |
| `remove-color` | browser | Perceptual (CIE L\*a\*b\*) match, feathered edges, spill suppression |
| `make-transparent`, `to-sticker` | browser | Cutout, plus a dilated contour border for stickers |
| `upscale`, `enhance` | upscale endpoint | Replicate → HuggingFace → sharp |
| `remove-object`, `generative-fill` | Gemini | Context-aware inpainting |
| `replace-bg`, `replace-object`, `add-object` | Gemini | |
| `isolate-subject` | Gemini | "Remove everyone except the main subject" |
| `sketch-to-photo`, `style-transfer`, `cartoon` | Gemini | |
| `relight`, `add-shadow` | Gemini | |
| `outpaint` | Gemini | Image expansion |
| `custom` | Gemini | Free-form prompt; global guards only |

### Per-intent tuning

`buildEditRequest` in `customer.controller.ts` expands an intent into the full
instruction: the user's own words lead, then a `guard` (what must be preserved)
and an `avoid` list (what must not happen). The two together are what stops an
edit bleeding outside its target, which is the dominant failure mode.

Optional model inputs are filtered against `MODEL_INPUT_SUPPORT` first —
Replicate rejects a whole prediction with a 422 if it receives a field the model
doesn't declare, so `negative_prompt` is folded into the instruction text for
models without one.

A `GLOBAL_GUARD` applies to every edit and pins text legibility and aspect
ratio. Text matters disproportionately here: these images go to transfer
printing, where a model quietly re-rendering a word into plausible-looking
gibberish is both the most common artefact and the most expensive one to find
after it is on a garment.

## Print-resolution conformance

Every generative model renders at its own canvas size — Gemini around 1024px,
Cloudflare's SD1.5 at 512 — and none guarantee the input's aspect ratio. For a
screen-only app that is cosmetic; here it is not. An artboard item's DPI is
`pixels / physical inches`, so a 1024px edit of a 4000px artwork silently drops a
300-DPI file to 77 DPI with nothing failing.

`conformToSource` (`src/utils/generativeImage.ts`) therefore resizes every
generative result back to the source's exact pixel dimensions, centre-cropping
rather than stretching if the aspect changed, and preserving alpha when the
source had it. That keeps `reframed: false` honest on the client, which is what
guarantees an edit leaves the item's position, print size and DPI untouched.

When the model rendered *below* the source resolution the response sets
`upsampled: true`. The pixel count is then honest but the detail is not, so the
UI says so and points at Enhance — a soft file behind a correct-looking DPI
number is the one defect a customer cannot see until it is printed.

## Prompt understanding

`planEdit` (`lib/ai/planner.ts`) turns one sentence into ordered atomic steps:

- **"Make the rabbit pink, then add a birthday hat"** → two steps, run in
  sequence, the second editing the output of the first.
- **"now make it bigger"** → resolved against the conversation, so follow-up
  refinement works without starting over.

Two tiers. The server planner (Gemini text model) understands intent and resolves
references. The local fallback splits on explicit sequence markers (`then`,
`after that`, `next`, …) and classifies by keyword. Single-step requests — the
large majority — classify identically either way, so an unreachable planner
costs referential resolution and nothing else.

A bare `and` is deliberately **not** a split point: "a dog and a cat wearing
hats" is one scene, and splitting it turns a coherent edit into two
contradictory ones. Under-splitting degrades to single-pass behaviour;
over-splitting destroys the request.

Chains are capped at 4 steps. Each step is a full round trip and compounds the
previous step's artefacts, so quality falls off before the time cost does. The
excess is reported to the user, not silently dropped.

Mixed requests are routed per fragment: **"make it 4 inches wide, then remove the
background"** runs the resize locally against the board geometry and sends only
the second clause to the model.

## Review before apply

A single-item edit is staged in `AiPreview` rather than applied. The customer
compares before/after on a draggable slider and accepts or discards; nothing
touches the artboard and no undo entry is committed until they do.

This is not redundant with undo. A generative edit is non-deterministic and
occasionally wrong in ways only a human can judge — and at artboard zoom the
defects that matter for a transfer (a fringe on a cutout, a colour a shade off, a
re-rendered word) are invisible, so the judgement has to happen at a useful size.

Batch runs skip review: comparing twelve edits through one slider is worse than
seeing them on the sheet, and undo covers the whole batch in one step.

## History

Three independent layers, each answering a different question:

1. **Board undo/redo** (`useHistory`) — snapshot stack over the items array.
   One entry per AI run, so a batch reverts in a single undo.
2. **Per-image AI chain** (`item.aiHistory`) — the last 10 states of *one*
   image, with thumbnails and one-click revert. Undo walks every action
   backwards, so reaching an edit from six operations ago also reverses five
   unrelated ones; this is scoped to one image and leaves the sheet alone.
   Persisted on the item, so it survives a reload and a saved design.
3. **Prompt history** (`localStorage`) — the last 20 prompts, for recall.

## Performance

- **No staging upload on the common path.** Gemini takes raw bytes, so the
  Cloudinary round trip of a print-resolution file is deferred behind a lazy
  getter and only happens if the request reaches the Replicate tier.
- **Local work stays local.** Background and colour removal never touch the
  network, so they work offline and while the generative tier is capped.
- **Colour matching is memoised per distinct RGB triple.** The Lab conversion is
  the expensive part of the loop and artwork is overwhelmingly repeated colours,
  which turns a per-pixel cost into a per-colour one.
- **The removal loop yields between row bands.** A 6000px artwork is tens of
  millions of pixels; without yielding it locks the main thread for seconds and
  the progress bar it drives never paints a frame.
- **Dominant colours are sampled at 200px.** Dominance is a statistical question
  and a thumbnail answers it identically, in a fraction of the time.
- **The colour module code-splits.** `ColorPickerStrip` imports it dynamically,
  so visitors who never open the AI panel don't download the pixel pipeline.
- **Capability probes are cached** with a definitive/failure split — a failed
  probe is retried after a short backoff rather than frozen into a permanent
  "unavailable" for the session.

## Extending

Add a provider (a new vendor, a specialist model) by writing one `AiEditProvider`
and calling `registerProvider`. Providers are tried in ascending `priority`,
skipping any that don't support the intent or aren't currently available; a
provider that throws falls through to the next. No UI or hook changes.

Add a tool by extending `AiIntentId`, then following the type errors: a verb, a
completion line, a `QUICK_ACTIONS` chip, a classifier rule, and server-side
tuning. The tuning table is covered by a test asserting that every intent the
planner may emit has generative guards — a new tool cannot ship untuned.
