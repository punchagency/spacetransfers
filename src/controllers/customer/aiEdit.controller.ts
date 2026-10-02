import { Request, Response, NextFunction } from "express";
import sharp from "sharp";
import { storeArtwork } from "../../services/storage.service.js";
import {
  editImageWithGemini,
  GeminiDeclinedError,
  geminiImageModel,
  geminiPlanningReady,
  geminiReady,
  geminiStatus,
  verifyGeminiKey,
  geminiUnavailableReason,
  planEditWithGemini,
} from "../../services/gemini.service.js";
import { conformToSource, readSourceGeometry } from "../../utils/generativeImage.js";
import { fetchImageBuffer } from "./shared.js";

// ── Generative AI editing ─────────────────────────────────────────────────────

/**
 * Instruction-based image editing model. Swapping vendors is a change to this
 * function alone — the client speaks only in {url, prompt, intent} and never
 * learns which model answered.
 */
const AI_EDIT_MODEL = process.env.AI_EDIT_MODEL || "black-forest-labs/flux-kontext-pro";

/**
 * Which optional inputs each model actually declares.
 *
 * A remote model would validate the whole prediction against its schema and
 * rejects it with a 422 if it receives a field the model does not declare — so
 * an optional input is only ever sent to a model known to accept it. Anything
 * absent from this table falls back to the conservative profile (prompt +
 * image only), which every instruction-edit model supports.
 *
 * Confirm against `GET /v1/models/<owner>/<name>` before adding a row: the
 * flux-kontext family exposes no negative_prompt / guidance / step controls,
 * so those knobs are simply unavailable there and the guidance has to travel
 * inside the prompt text instead.
 */
interface ModelInputSupport {
  negativePrompt: boolean;
  guidance: boolean;
  steps: boolean;
  seed: boolean;
  promptUpsampling: boolean;
}

const CONSERVATIVE_INPUT_SUPPORT: ModelInputSupport = {
  negativePrompt: false,
  guidance: false,
  steps: false,
  seed: false,
  promptUpsampling: false,
};

const MODEL_INPUT_SUPPORT: Record<string, ModelInputSupport> = {
  "black-forest-labs/flux-kontext-pro": {
    ...CONSERVATIVE_INPUT_SUPPORT,
    seed: true,
    promptUpsampling: true,
  },
  "black-forest-labs/flux-kontext-max": {
    ...CONSERVATIVE_INPUT_SUPPORT,
    seed: true,
    promptUpsampling: true,
  },
};

const inputSupportFor = (model: string): ModelInputSupport =>
  MODEL_INPUT_SUPPORT[model] ?? CONSERVATIVE_INPUT_SUPPORT;

/**
 * Per-intent tuning. `guard` states what the model must preserve, `avoid` what
 * it must not do — the two together are what stops an edit bleeding outside the
 * thing the user asked to change, which is the dominant failure mode here.
 *
 * `upsample` asks the model to expand a terse instruction before running. It's
 * on for the chip-driven intents (whose prompts are a handful of words) and off
 * where the user's exact wording is the whole point — rewriting "make it gold"
 * into a paragraph is how a recolour turns into a restyle.
 */
interface IntentTuning {
  guard: string;
  avoid: string;
  upsample?: boolean;
  /** Optional per-intent override, e.g. route inpainting to a specialist model. */
  model?: string;
}

const INTENT_TUNING: Record<string, IntentTuning> = {
  "replace-bg": {
    guard:
      "Replace only the background behind the subject with what is described. Keep the subject's pose, proportions, colours and lighting exactly as they are, and blend its edges cleanly into the new background.",
    avoid:
      "altering, recolouring or moving the subject; leaving a halo, fringe or cut-out outline around the subject; changing the subject's scale or crop",
    upsample: true,
  },
  "change-color": {
    guard:
      "Recolour only the element described, to exactly the colour requested. Preserve its original shape, texture, shading, highlights and material finish.",
    avoid:
      "changing the background; altering any element other than the one named; flattening or posterising the shading; changing its shape, texture or proportions",
    // The colour word is the payload — upsampling tends to editorialise it.
    upsample: false,
  },
  "remove-object": {
    guard:
      "Remove the described object completely and reconstruct what would be behind it, matching the surrounding texture, lighting and perspective so it reads as though the object was never there.",
    avoid:
      "leaving fragments, outlines or ghosting of the removed object; blurring or smudging the patched area; altering any other element",
    upsample: true,
  },
  "add-shadow": {
    guard:
      "Add a single realistic contact shadow beneath the subject, consistent with the existing light direction, softness and intensity.",
    avoid:
      "modifying the subject itself; adding harsh pure-black or multiple conflicting shadows; changing the background",
    upsample: true,
  },
  "to-sticker": {
    guard:
      "Isolate the subject and present it as a die-cut sticker with a clean, even white contour border that follows its silhouette, on a plain background.",
    avoid:
      "cropping or clipping the subject; producing an uneven, broken or coloured border; adding drop shadows or background detail",
    upsample: true,
  },
  cartoon: {
    guard:
      "Restyle the artwork as described while preserving the original composition, pose, and the subject's identity and proportions.",
    avoid:
      "changing the composition or framing; adding or removing elements; distorting faces, hands or lettering",
    upsample: true,
  },
  "make-transparent": {
    guard:
      "Isolate the subject on a plain, empty background with clean, sharp edges.",
    avoid: "altering the subject; leaving background remnants, halos or soft fringing",
    upsample: true,
  },
  /**
   * Background removal normally runs in the browser (WASM segmentation), which
   * is both better and free. But the generative tier is the fallback for *every*
   * intent, so a client that cannot run the local path — a cross-origin asset
   * that taints the canvas, an unsupported browser — arrives here. Without
   * tuning it would get the bare global guard and no instruction to cut cleanly,
   * which on hair, fur and semi-transparent edges is the difference between a
   * usable cutout and a haloed one.
   */
  "remove-bg": {
    guard:
      "Remove the background completely, leaving only the subject on a plain empty background. Follow the subject's true silhouette precisely, including fine detail such as individual strands of hair, fur and thin or wispy edges, and keep partially transparent areas partially transparent rather than solid.",
    avoid:
      "altering, recolouring or re-framing the subject; leaving background remnants, a halo, a coloured fringe or a visible cut-out outline; hardening soft or wispy edges into a solid shape; discarding fine detail at the subject's boundary",
    upsample: true,
  },
  "remove-color": {
    guard:
      "Remove only the colour described, everywhere it appears. Where that colour was part of the background, leave plain empty space; where it was part of an object, reconstruct what the object looks like without it while keeping the object's shape and shading intact.",
    avoid:
      "altering any other colour in the image; shifting the overall hue, white balance or saturation; leaving speckles or a fringe of the removed colour along edges",
    upsample: true,
  },
  "replace-object": {
    guard:
      "Replace only the object described with the new one, matching the original's position, scale, orientation, perspective and lighting so it sits in the scene naturally.",
    avoid:
      "altering the background or any other object; changing the composition or framing; leaving traces of the original object; producing a pasted-on look with mismatched lighting or edges",
    upsample: true,
  },
  "add-object": {
    guard:
      "Add the described element to the image, matched to the existing perspective, scale, lighting direction and colour temperature, and correctly occluded by anything in front of it.",
    avoid:
      "altering or moving anything already in the image; changing the composition or framing; adding more than what was asked for; floating the new element with no contact shadow",
    upsample: true,
  },
  "isolate-subject": {
    guard:
      "Keep only the single main subject and remove every other person and object, reconstructing the background plausibly where they were.",
    avoid:
      "altering the main subject in any way; leaving fragments, limbs or shadows of the removed subjects; cropping or re-framing the image",
    upsample: true,
  },
  "sketch-to-photo": {
    guard:
      "Render the drawing as a photorealistic photograph, preserving the exact composition, pose, proportions and every element present in the sketch.",
    avoid:
      "adding elements absent from the sketch; changing the pose, layout or proportions; retaining visible line art, paper texture or pencil shading",
    upsample: true,
  },
  "style-transfer": {
    guard:
      "Re-render the image in the style described while preserving the composition, subject identity, pose and proportions exactly.",
    avoid:
      "changing the composition or framing; adding or removing elements; distorting faces, hands or lettering",
    upsample: true,
  },
  relight: {
    guard:
      "Change only the lighting as described. Re-derive shadows, highlights and colour temperature consistently across the whole scene while keeping every object's position, shape and material unchanged.",
    avoid:
      "moving, adding or removing objects; changing the subject's colours beyond what the new lighting implies; producing shadows inconsistent with the new light direction",
    upsample: true,
  },
  outpaint: {
    guard:
      "Extend the scene outward beyond its current edges, continuing the existing perspective, lighting, texture and content so the original area remains pixel-identical and the join is invisible.",
    avoid:
      "altering, rescaling or re-centring the original image content; introducing a visible seam, border or tonal step at the original edges; inventing a subject that contradicts the scene",
    upsample: true,
  },
  "generative-fill": {
    guard:
      "Fill the described region with plausible content that matches the surrounding texture, lighting, perspective and grain.",
    avoid:
      "altering anything outside the described region; blurring or smudging the filled area; leaving a visible patch boundary",
    upsample: true,
  },
};

/**
 * Applies to every generative edit regardless of intent. Text is called out
 * because these images are headed for transfer printing, where a model quietly
 * re-rendering a word into plausible-looking gibberish is both the most common
 * artefact and the most expensive one to discover after it is on a garment.
 */
const GLOBAL_GUARD =
  "Keep any text in the image exactly as written and fully legible unless the request explicitly asks to change it. Preserve the original framing and aspect ratio.";

/**
 * Intents the generative stack can serve, derived from the tuning table rather
 * than hand-listed so the capabilities probe cannot drift out of step with what
 * `buildEditRequest` actually knows how to guard. `custom` is appended because
 * a free-form prompt is always accepted — it simply carries no per-intent
 * tuning beyond the global guard.
 */
const SERVER_EDIT_INTENTS = [...Object.keys(INTENT_TUNING), "custom"];

export interface BuiltEditRequest {
  instruction: string;
  model: string;
  /** Extra model inputs, already filtered to what this model accepts. */
  extraInput: Record<string, unknown>;
}

/**
 * Expands a canonical intent into the full request the editing model receives.
 * The user's own words always lead, so a chip press and a typed sentence
 * converge on the same shape; the tuning is appended as constraints.
 *
 * Negative guidance goes into `negative_prompt` when the model has one and is
 * folded into the instruction text otherwise, so the constraint survives either
 * way. Each `avoid` entry is phrased as a gerund under a single governing
 * "Avoid all of the following:" header — a bare "Do not a; b; c" negates only
 * the first item and reads as an instruction to perform the rest.
 */
export const buildEditRequest = (
  intent: string,
  prompt: string,
  seed?: number,
): BuiltEditRequest => {
  const tuning = INTENT_TUNING[intent];
  const model = tuning?.model || AI_EDIT_MODEL;
  const support = inputSupportFor(model);
  const extraInput: Record<string, unknown> = {};

  const parts = [prompt.trim().replace(/\.$/, "")];
  if (tuning) {
    parts.push(tuning.guard);
    if (support.negativePrompt) extraInput.negative_prompt = tuning.avoid;
    else parts.push(`Avoid all of the following: ${tuning.avoid}.`);
    if (support.promptUpsampling && tuning.upsample) extraInput.prompt_upsampling = true;
  }
  parts.push(GLOBAL_GUARD);

  // A caller-supplied seed makes a run reproducible, which is what lets two
  // phrasings of the same edit be compared without the noise of a fresh sample.
  if (support.seed && Number.isFinite(seed)) extraInput.seed = Math.trunc(seed as number);

  return { instruction: parts.join(". ").replace(/\.\.+/g, "."), model, extraInput };
};

/**
 * Readiness probe. The client caches this for the session and uses it to decide
 * whether generative chips are live, so a user never fires a request that is
 * guaranteed to 503.
 */
export const aiEditCapabilities = async (_req: Request, res: Response) => {
  // Once per server start (and after a key block lapses): answers truthfully
  // from the first request instead of only after an edit has failed.
  await verifyGeminiKey();

  // One provider now, so the array is a list of one or of none. Kept as an
  // array because the client reads `tiers[0]` to name the model it is about to
  // use, and that contract has not changed.
  const tiers = geminiReady()
    ? [{ provider: "gemini", model: geminiImageModel() }]
    : [];

  // Lets an operator see *why* the feature is dark without reading logs, and
  // distinguishes the three states that look identical from the client:
  // nothing configured, configured but capped, configured but unfunded.
  const geminiState = geminiStatus();
  const reason =
    tiers.length > 0 || geminiState === "unconfigured" || geminiState === "ready"
      ? undefined
      : geminiState;

  res.json({
    enabled: tiers.length > 0,
    model: tiers[0]?.model,
    tiers,
    // The intents the whole stack can serve. The client uses this to decide
    // which chips are live, so a customer never clicks into a guaranteed error.
    intents: tiers.length > 0 ? SERVER_EDIT_INTENTS : [],
    // Multi-step planning rides on the text models, which have their own quota —
    // it stays available even while the *image* tier is capped or unfunded.
    planning: geminiPlanningReady(),
    ...(reason ? { reason } : {}),
    // The operator-facing fix, surfaced through the API so the reason a feature
    // is dark is visible without shell access to the logs.
    ...(tiers.length === 0 && geminiUnavailableReason()
      ? { detail: geminiUnavailableReason() }
      : {}),
  });
};

/**
 * Prompt understanding.
 *
 * Turns one sentence into an ordered list of atomic edits, resolving follow-ups
 * against the conversation so far — "make the rabbit pink, then add a birthday
 * hat" becomes two steps, and a later "make it bigger" knows what "it" is.
 *
 * Separate from `aiEditAsset` on purpose. It runs on the cheap text model, needs
 * no image, and returns in a second or two, so the client can call it on submit
 * and show the plan before committing to any image work. It is also strictly
 * optional: a null plan means the client falls back to its own keyword
 * classifier, which handles single-step requests perfectly well.
 */
export const aiEditPlan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, history } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return next(Object.assign(new Error("prompt is required"), { statusCode: 400 }));
    }

    await verifyGeminiKey();
    if (!geminiPlanningReady()) {
      // 200, not 503. An absent planner is a missing enhancement, not a failed
      // request — the client is expected to proceed on its local classifier, and
      // an error status would make it report a problem the customer doesn't have.
      return res.json({ planned: false, steps: [] });
    }

    // Only the shape the planner needs, and bounded: an unbounded client-supplied
    // array would otherwise decide how many tokens this endpoint spends.
    const turns = Array.isArray(history)
      ? history
          .filter(
            (h: any) =>
              h &&
              typeof h.text === "string" &&
              h.text.trim() &&
              (h.role === "user" || h.role === "assistant"),
          )
          .slice(-12)
          .map((h: any) => ({
            role: h.role as "user" | "assistant",
            text: String(h.text).slice(0, 500),
          }))
      : [];

    const plan = await planEditWithGemini(prompt.trim(), turns);
    if (!plan) return res.json({ planned: false, steps: [] });

    console.log(
      `[AI-PLAN] ${plan.steps.length} step(s) — "${prompt.slice(0, 60)}"` +
        `${plan.clarification ? " (clarification)" : ""}${plan.reply ? " (reply)" : ""}`,
    );

    res.json({
      planned: true,
      steps: plan.steps,
      ...(plan.clarification ? { clarification: plan.clarification } : {}),
      ...(plan.reply ? { reply: plan.reply } : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const aiEditAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url, prompt, intent, seed } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return next(Object.assign(new Error("prompt is required"), { statusCode: 400 }));
    }
    await verifyGeminiKey();
    if (!geminiReady()) {
      const stillWorks =
        " Background removal, colour removal, upscaling and all board commands still work.";
      const status = geminiStatus();
      const message =
        status === "billing_required"
          ? "Generative AI editing isn't available on this server's API key yet — its image models have no free allowance." + stillWorks
          : status === "daily_cap"
          ? "Today's AI edit allowance is used up. It resets on Google's daily quota." + stillWorks
          : status === "rate_limited"
          ? "The image model is handling a lot of requests right now. Try again in a moment." + stillWorks
          : status === "retired"
          ? "The configured image model is no longer available." + stillWorks
          : status === "invalid_key"
          ? "AI image editing isn't set up correctly on this server yet." + stillWorks
          : "AI editing isn't configured on this server yet.";

      const detail = geminiUnavailableReason();
      if (detail) console.warn(`[AI-EDIT] unavailable — ${detail}`);
      return next(Object.assign(new Error(message), { statusCode: 503, detail }));
    }

    const sourceBuffer = await fetchImageBuffer(url);
    const sourceGeometry = await readSourceGeometry(sourceBuffer);
    const sourceMeta = await sharp(sourceBuffer, { limitInputPixels: false }).metadata();
    const sourceMimeType = `image/${sourceMeta.format === "jpg" ? "jpeg" : sourceMeta.format || "png"}`;

    const built = buildEditRequest(
      String(intent || "custom"),
      prompt,
      typeof seed === "number" ? seed : undefined,
    );

    /*
     * The lazy Cloudinary staging that lived here went with Replicate.
     *
     * It existed only because a remote model needed a publicly reachable URL,
     * which meant uploading a print-resolution file just to have something to
     * link to. Gemini takes the bytes directly, so nothing is staged and no
     * extra copy of a customer's artwork is made as a side effect of an edit.
     */

    // Gemini is the whole implementation.
    let editedBuffer: Buffer | undefined;
    let providerUsed = "";
    let modelUsed = built.model;
    // Kept so an exhausted chain can report *why* rather than reporting that it
    // is exhausted, which is the part the caller can already see.
    let lastTierError: string | undefined;

    if (geminiReady()) {
      try {
        const result = await editImageWithGemini(
          sourceBuffer,
          sourceMimeType,
          built.instruction,
        );
        editedBuffer = result.buffer;
        providerUsed = "gemini";
        modelUsed = result.model;
      } catch (geminiErr: any) {
        // A refusal is an answer, not an outage — say what the model said, and
        // don't tell the customer the service is down or that they should retry.
        if (geminiErr instanceof GeminiDeclinedError) {
          const said = String(geminiErr.message).replace(/\s+/g, " ").trim().slice(0, 300);
          console.warn(`[AI-EDIT] declined for intent "${intent}" — ${said}`);
          return next(
            Object.assign(new Error(`The AI couldn't make this edit: ${said} Try rewording it.`), {
              statusCode: 422,
            }),
          );
        }
        console.warn(`[AI-EDIT] Gemini failed (${geminiErr?.message}) — falling back`);
        lastTierError = `Gemini: ${geminiErr?.message}`;
        editedBuffer = undefined;
      }
    }

    if (!editedBuffer) {
      const detail = geminiUnavailableReason() ?? lastTierError;
      console.warn(`[AI-EDIT] all tiers failed for intent "${intent}" — ${detail ?? "no detail"}`);

      const advice =
        geminiStatus() === "billing_required"
          ? " Generative editing needs billing enabled on the Gemini key."
          : "";

      return next(
        Object.assign(
          new Error(
            "No image model could complete this edit right now." +
              advice +
              " Background removal, colour removal, upscaling and all board commands still work.",
          ),
          { statusCode: 503, detail },
        ),
      );
    }

    // Every generative tier renders at its own canvas size, none of them at the
    // source's. Conforming here — rather than in each tier — means the artboard
    // receives the same geometry contract regardless of which model answered,
    // and the item's physical size and DPI survive the edit intact.
    const conformed = await conformToSource(editedBuffer, sourceGeometry);

    const { url: editedUrl } = await storeArtwork(
      conformed.buffer,
      "space-transfers/ai-edited",
    );

    // Logged together so a bad result can be traced back to the exact model and
    // inputs that produced it — the instruction is derived, not user-supplied.
    console.log(
      `[AI-EDIT] ${intent} via ${providerUsed}/${modelUsed}` +
        `${built.extraInput.seed !== undefined ? ` seed=${built.extraInput.seed}` : ""}` +
        `${conformed.upsampled ? " upsampled" : ""}${conformed.cropped ? " aspect-corrected" : ""}` +
        ` — "${prompt.slice(0, 60)}"`,
    );

    res.json({
      url: editedUrl,
      widthPx: conformed.widthPx,
      heightPx: conformed.heightPx,
      originalWidthPx: sourceGeometry.width,
      originalHeightPx: sourceGeometry.height,
      // Echoed so the same edit can be reproduced or re-rolled deliberately.
      seed: built.extraInput.seed,
      model: modelUsed,
      // Generative edits repaint the full frame and the result has been
      // conformed to the source's exact dimensions, so the item's print box on
      // the artboard must be preserved as-is.
      reframed: false,
      /**
       * The model rendered below print resolution and was scaled back up. The
       * pixel count is honest but the *detail* is not, so the client says so
       * and offers Enhance rather than letting a soft file reach a garment
       * behind a DPI number that looks fine.
       */
      upsampled: conformed.upsampled,
      // The real provider, not a hardcoded one — the client shows this in the
      // result toast, and attributing a Cloudflare result to Gemini would make
      // a quality drop impossible to explain.
      provider: providerUsed,
    });
  } catch (error) {
    next(error);
  }
};
