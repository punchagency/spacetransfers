import { env } from "../config/env.js";

/**
 * Google Gemini — the free tier of the generative editing stack.
 *
 * Two distinct jobs, deliberately split across two models because they have
 * very different cost and latency profiles:
 *
 *  - `gemini-2.5-flash-image` ("Nano Banana") does the pixel work: instruction
 *    editing of an existing image. This is what serves remove-object,
 *    replace-bg, recolour, restyle and every free-form prompt.
 *  - `gemini-2.5-flash` does *prompt understanding*: turning "make the rabbit
 *    pink, then add a birthday hat" into an ordered list of single-purpose
 *    edits. Text tokens are orders of magnitude cheaper than image tokens, so
 *    planning with the image model would be wasteful and slower.
 *
 * Both run on an AI Studio API key with no card attached, which is why this is
 * registered ahead of the paid tiers rather than behind them.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const IMAGE_MODELS = env.geminiImageModel
  ? [env.geminiImageModel]
  : ["gemini-2.5-flash-image", "gemini-3.1-flash-lite-image", "gemini-3.1-flash-image"];

const TEXT_MODELS = env.geminiTextModel
  ? [env.geminiTextModel]
  : ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"];

const IMAGE_TIMEOUT_MS = 120_000;
const TEXT_TIMEOUT_MS = 20_000;
/** Vision requests carry image bytes, so they need more room than a prompt. */
const VISION_TIMEOUT_MS = 45_000;

/**
 * Why a model is currently unusable.
 *
 * `billing_required` is the important distinction and the one this originally
 * got wrong. Google returns HTTP 429 both for "you are going too fast" and for
 * "this model has no free tier on your project" — the latter reported as
 * `limit: 0` in the quota violation. They look identical at the status-code
 * level and are opposites in every way that matters:
 *
 *  - A rate limit clears on its own in seconds. Retrying is correct.
 *  - `limit: 0` never clears. No amount of waiting helps, because the
 *    allowance is zero until someone enables billing on the project.
 *
 * Treating the second as the first is actively harmful: it tells the customer
 * "try again in a moment" about something that will fail identically forever,
 * and it keeps re-probing a model that cannot succeed. So `limit: 0` parks the
 * model for a long window and reports a message naming the actual fix.
 */
type ModelBlock = "rate_limited" | "daily_cap" | "billing_required" | "retired" | "invalid_key";

const BLOCK_DURATION_MS: Record<ModelBlock, number> = {
  // A per-minute burst clears in about a minute.
  rate_limited: 60_000,
  // A daily cap does not, so retrying every minute is pure added latency.
  daily_cap: 30 * 60_000,
  /**
   * Deliberately short, and shorter than the daily cap despite needing human
   * action — because the moment that action is taken the model starts working,
   * and nothing tells the server it happened.
   *
   * A long window optimises for the wrong thing. It saves a handful of doomed
   * probes while an operator is enabling billing, at the cost of the feature
   * staying dark for the rest of that window *after* they have already fixed
   * it — which reads as the fix not working and invites them to undo it. Five
   * minutes bounds the wasted requests to one per five minutes and bounds the
   * post-fix confusion to five minutes, which is the right trade.
   */
  billing_required: 5 * 60_000,
  // A retired model id is permanent for this deploy; the fallback list covers it.
  retired: 6 * 60 * 60_000,
  /**
   * Google rejected the key itself. Every model fails identically until the key
   * is replaced, so they are all parked — the capabilities probe then reports
   * the feature as off instead of "enabled", which is what it said while every
   * edit and every plan failed with a 400. Short, like billing: nothing tells
   * the server when the key is fixed.
   */
  invalid_key: 5 * 60_000,
};

interface BlockState {
  reason: ModelBlock;
  until: number;
}

/** Per-model, so one capped or retired model never darks the others. */
const blocked = new Map<string, BlockState>();

const isBlocked = (model: string): boolean => {
  const state = blocked.get(model);
  if (!state) return false;
  if (Date.now() >= state.until) {
    blocked.delete(model);
    return false;
  }
  return true;
};

const blockModel = (model: string, reason: ModelBlock) => {
  blocked.set(model, { reason, until: Date.now() + BLOCK_DURATION_MS[reason] });
  console.warn(
    `[GEMINI] ${model} unavailable (${reason}) — skipping for ${Math.round(BLOCK_DURATION_MS[reason] / 60_000)} min`,
  );
};

const availableModels = (candidates: string[]): string[] =>
  candidates.filter((model) => !isBlocked(model));

/** The most informative block reason across a set of candidates. */
const worstBlock = (candidates: string[]): ModelBlock | null => {
  // Ordered by how much operator action each needs: billing first, since it is
  // the only one a human has to act on.
  const priority: ModelBlock[] = ["invalid_key", "billing_required", "retired", "daily_cap", "rate_limited"];
  for (const reason of priority) {
    if (candidates.some((m) => blocked.get(m)?.reason === reason)) return reason;
  }
  return null;
};

export const hasGemini = (): boolean => Boolean(env.geminiApiKey);

/**
 * Checks the key once, with Google's model list — a free call that spends no
 * quota — so a rejected key is known before any customer tries an edit.
 *
 * Without this the server only learned the key was bad from the first failed
 * edit or plan: until then the capabilities probe said "enabled" and the panel
 * offered every model-only action, each of which failed. Settles within a few
 * seconds either way; a network failure proves nothing, so it is ignored and
 * the ordinary per-call handling takes over.
 */
let keyCheck: Promise<void> | null = null;
export const verifyGeminiKey = (): Promise<void> => {
  if (!hasGemini()) return Promise.resolve();
  keyCheck ??= (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${GEMINI_BASE}?pageSize=1`, {
        headers: { "x-goog-api-key": env.geminiApiKey! },
        signal: controller.signal,
      });
      if (response.ok) return;
      const text = await response.text().catch(() => "");
      if (classifyFailure(response.status, text) === "invalid_key") {
        for (const m of [...IMAGE_MODELS, ...TEXT_MODELS]) blockModel(m, "invalid_key");
        // Re-checked after the block lapses, in case the key was replaced.
        setTimeout(() => { keyCheck = null; }, BLOCK_DURATION_MS.invalid_key).unref?.();
      }
    } catch {
      // Unreachable is not invalid.
    } finally {
      clearTimeout(timer);
    }
  })();
  return keyCheck;
};

/** True when a key is set and at least one image model is currently usable. */
export const geminiReady = (): boolean =>
  hasGemini() && availableModels(IMAGE_MODELS).length > 0;

/** True when planning is possible — a separate model family with its own quota. */
export const geminiPlanningReady = (): boolean =>
  hasGemini() && availableModels(TEXT_MODELS).length > 0;

/** Why the image tier is dark, for the capabilities probe and operator logs. */
export const geminiStatus = ():
  | "ready"
  | "unconfigured"
  | "rate_limited"
  | "daily_cap"
  | "billing_required"
  | "retired"
  | "invalid_key" => {
  if (!hasGemini()) return "unconfigured";
  if (availableModels(IMAGE_MODELS).length > 0) return "ready";
  return worstBlock(IMAGE_MODELS) ?? "rate_limited";
};

/** First currently-usable image model, for reporting which one will answer. */
export const geminiImageModel = () => availableModels(IMAGE_MODELS)[0] ?? IMAGE_MODELS[0];
export const geminiTextModel = () => availableModels(TEXT_MODELS)[0] ?? TEXT_MODELS[0];

/**
 * Classifies a failure response so the right model gets parked for the right
 * length of time.
 *
 * The `limit: 0` test comes first and deliberately matches on the quota
 * violation rather than the prose: the human-readable message for a zero
 * allowance and for an exhausted one are the same sentence, and only the
 * numeric limit tells them apart.
 */
export const classifyFailure = (status: number, body: string): ModelBlock | null => {
  if (status === 404 || /no longer available|not found for API version/i.test(body)) {
    return "retired";
  }
  // The key itself was refused ("API key not valid", API_KEY_INVALID, or a
  // 401/403). Checked before the quota cases: no model can succeed with it.
  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(body))
  ) {
    return "invalid_key";
  }
  if (status !== 429) return null;

  // `"limit": 0` means this model has no free-tier allowance at all on this
  // project. Waiting cannot fix it; enabling billing can.
  if (/"?limit"?:\s*0\b/.test(body)) return "billing_required";
  if (/per\s*day|daily|PerDay|requests per day/i.test(body)) return "daily_cap";
  return "rate_limited";
};

/** A success proves the model is usable — clear any stale block on it. */
const recordSuccess = (model: string) => {
  blocked.delete(model);
};

/**
 * Operator-facing explanation of why generative editing is unavailable.
 *
 * Returned to the client so the customer sees something true and the operator
 * sees the fix, instead of a generic "no model could complete this edit" that
 * gives neither of them anywhere to go.
 */
export const geminiUnavailableReason = (): string | null => {
  if (!hasGemini()) return null;
  const reason = geminiStatus();
  switch (reason) {
    case "billing_required":
      return (
        "Gemini image editing has no free-tier allowance on this API key — Google reports a quota limit of 0 for its image models. " +
        "Enable billing on the key's Google Cloud project at https://aistudio.google.com/apikey (image edits are ~$0.04 each), " +
        "Gemini is the only image model configured, so there is nothing to fall back to."
      );
    case "retired":
      return (
        "Every configured Gemini image model was rejected as unavailable, which usually means the pinned model id has been retired. " +
        "Clear GEMINI_IMAGE_MODEL to use the built-in fallback list, or set it to a current image model."
      );
    case "invalid_key":
      return (
        "Google rejected GEMINI_API_KEY as not valid. Set a working key from https://aistudio.google.com/apikey " +
        "in the server's .env and restart the server."
      );
    case "daily_cap":
      return "Today's Gemini image allowance is used up. It resets on Google's daily quota.";
    case "rate_limited":
      return "The image model is handling too many requests right now. Try again in a moment.";
    default:
      return null;
  }
};

/**
 * The model answered but made no image — a refusal (safety, or an edit it
 * judges impossible). Not an outage: the other models are not tried, since the
 * same request is refused the same way, and the model's own explanation is what
 * the customer should read.
 */
export class GeminiDeclinedError extends Error {}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

const callGemini = async (
  model: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honour an upstream cancel (the customer pressed Stop) as well as the timeout.
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header rather than ?key= so the key never lands in a proxy access log.
        "x-goog-api-key": env.geminiApiKey!,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const block = classifyFailure(response.status, text);
      if (block === "invalid_key") {
        for (const m of [...IMAGE_MODELS, ...TEXT_MODELS]) blockModel(m, block);
      } else if (block) blockModel(model, block);
      throw new Error(`Gemini ${response.status}: ${text.slice(0, 300)}`);
    }

    recordSuccess(model);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};

const partsOf = (payload: any): GeminiPart[] => {
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts;
  return Array.isArray(parts) ? parts : [];
};

/**
 * Edits an image from a natural-language instruction.
 *
 * Returns the raw bytes and the mime type the model actually produced — the
 * caller conforms them to the source's resolution and aspect before they touch
 * an artboard item, because print geometry depends on those numbers.
 */
export const editImageWithGemini = async (
  source: Buffer,
  sourceMimeType: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string; model: string }> => {
  const candidates = availableModels(IMAGE_MODELS);
  if (candidates.length === 0) {
    throw new Error(geminiUnavailableReason() ?? "No Gemini image model is available.");
  }

  let lastError: unknown = null;
  for (const model of candidates) {
    try {
      return await editWithModel(model, source, sourceMimeType, instruction, signal);
    } catch (error: any) {
      // A cancel is the caller's decision — stop the whole chain immediately
      // rather than burning the remaining models on work nobody is waiting for.
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      if (error instanceof GeminiDeclinedError) throw error;
      lastError = error;
      console.warn(`[GEMINI] ${model} failed (${error?.message?.slice(0, 120)}) — trying next model`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini could not complete this edit.");
};

const editWithModel = async (
  model: string,
  source: Buffer,
  sourceMimeType: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string; model: string }> => {
  const payload = await callGemini(
    model,
    {
      contents: [
        {
          role: "user",
          // Instruction first, image second: the image models attend to the
          // trailing image as the thing being operated on, and putting the
          // instruction after it reads as a caption more often than a command.
          parts: [
            { text: instruction },
            { inline_data: { mime_type: sourceMimeType, data: source.toString("base64") } },
          ],
        },
      ],
      generationConfig: {
        // TEXT is included alongside IMAGE on purpose. Asked for IMAGE alone,
        // a refusal (safety, or an instruction it judges impossible) comes back
        // as an empty candidate with no way to tell the customer why. With TEXT
        // allowed, the model explains itself and that explanation is surfaced.
        responseModalities: ["TEXT", "IMAGE"],
      },
    },
    IMAGE_TIMEOUT_MS,
    signal,
  );

  const parts = partsOf(payload);
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    const data = (inline as any)?.data;
    if (typeof data === "string" && data.length > 0) {
      const mimeType =
        (inline as any)?.mimeType ?? (inline as any)?.mime_type ?? "image/png";
      return { buffer: Buffer.from(data, "base64"), mimeType, model };
    }
  }

  // No image came back. Prefer the model's own words — "I can't edit images of
  // real people" is actionable, "the model returned no image" is not.
  const explanation = parts
    .map((p) => p.text)
    .filter((t): t is string => Boolean(t && t.trim()))
    .join(" ")
    .trim();
  const blockReason =
    payload?.promptFeedback?.blockReason ?? payload?.candidates?.[0]?.finishReason;

  throw new GeminiDeclinedError(
    explanation ||
      (blockReason
        ? `The model declined this edit (${blockReason}).`
        : "The model returned no image."),
  );
};

/* ------------------------------------------------------------------ *
 * Structured generation
 * ------------------------------------------------------------------ */

/** A content part: text, or an inline image for the vision models. */
export type GeminiPartInput =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Runs a JSON-schema-constrained request against the text/vision models.
 *
 * Shared because the planner and the fade checker want exactly the same thing —
 * a schema-validated object out of a flash model — and differ only in their
 * prompt and parts. Notably the *vision* work rides here too: these models take
 * images as input and bill them as input tokens, which is a different quota
 * from the image-*generation* models, so image analysis stays on the free tier
 * even while generative editing is unavailable.
 *
 * Walks the model list so a retired or capped model falls through to the next.
 * Returns null rather than throwing: every caller treats structured generation
 * as an enhancement with a deterministic fallback behind it.
 */
export const generateJsonWithGemini = async (options: {
  system: string;
  schema: unknown;
  parts: GeminiPartInput[];
  signal?: AbortSignal;
  /** Defaults to the text budget; raise it when parts include images. */
  timeoutMs?: number;
}): Promise<any | null> => {
  if (!geminiPlanningReady()) return null;

  // Images take materially longer to upload and encode than a prompt, so a
  // request carrying them gets a wider window by default — timing one out at
  // the text budget would report a healthy model as unavailable.
  const hasImages = options.parts.some((part) => "inlineData" in part);
  const timeoutMs = options.timeoutMs ?? (hasImages ? VISION_TIMEOUT_MS : TEXT_TIMEOUT_MS);

  for (const model of availableModels(TEXT_MODELS)) {
    try {
      const payload = await callGemini(
        model,
        {
          systemInstruction: { parts: [{ text: options.system }] },
          contents: [
            {
              role: "user",
              parts: options.parts.map((part) =>
                "text" in part
                  ? { text: part.text }
                  : {
                      inline_data: {
                        mime_type: part.inlineData.mimeType,
                        data: part.inlineData.data,
                      },
                    },
              ),
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: options.schema,
            // A classification task, not a creative one — the same image should
            // get the same verdict every time it is checked.
            temperature: 0,
          },
        },
        timeoutMs,
        options.signal,
      );

      const raw = partsOf(payload)
        .map((p) => p.text)
        .filter((t): t is string => typeof t === "string")
        .join("");
      if (!raw.trim()) continue;

      return JSON.parse(raw);
    } catch (error: any) {
      if (error?.name === "AbortError" || options.signal?.aborted) throw error;
      console.warn(`[GEMINI] ${model} JSON generation failed (${error?.message?.slice(0, 120)})`);
    }
  }

  return null;
};

/* ------------------------------------------------------------------ *
 * Prompt understanding
 * ------------------------------------------------------------------ */

/** One atomic edit in a plan. `intent` is a client-side canonical intent id. */
export interface PlannedStep {
  intent: string;
  /** Self-contained instruction for this step alone. */
  prompt: string;
  /** Short present-tense label for the progress UI, e.g. "Making it pink". */
  label: string;
}

export interface EditPlan {
  steps: PlannedStep[];
  /** Set when the request is too underspecified to run — asked, not guessed. */
  clarification?: string;
  /** Conversational answer for prompts that aren't edits at all ("what can you do?"). */
  reply?: string;
}

/**
 * The intents the planner is allowed to emit. Kept in lockstep with the
 * client's `AiIntentId` union: a step naming an intent the client doesn't know
 * would route to the generic generative path and silently lose its tuning.
 */
export const PLANNABLE_INTENTS = [
  "remove-bg",
  "replace-bg",
  "remove-color",
  "change-color",
  "remove-object",
  "replace-object",
  "add-object",
  "isolate-subject",
  "sketch-to-photo",
  "style-transfer",
  "relight",
  "outpaint",
  "generative-fill",
  "upscale",
  "enhance",
  "make-transparent",
  "to-sticker",
  "add-shadow",
  "cartoon",
  "custom",
] as const;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          intent: { type: "string", enum: [...PLANNABLE_INTENTS] },
          prompt: { type: "string" },
          label: { type: "string" },
        },
        required: ["intent", "prompt", "label"],
      },
    },
    clarification: { type: "string" },
    reply: { type: "string" },
  },
  required: ["steps"],
} as const;

const PLANNER_SYSTEM = `You decompose image-editing requests for a print-on-demand artwork editor.

Return ONLY JSON matching the schema.

Rules:
- Split multi-part requests into ordered atomic steps. Each step must do exactly ONE thing, and its "prompt" must be a complete self-contained instruction that makes sense with no knowledge of the other steps or of the conversation.
- Resolve pronouns and references from the conversation history. If the history shows the subject is a balloon dog that was turned into a rabbit, "make it pink" becomes "Make the balloon rabbit pink".
- Prefer the most specific intent available. Use "custom" only when nothing else fits.
- Intent guide: remove-color removes/replaces one specific colour; change-color recolours a named element; remove-object erases a thing and fills the gap; replace-object swaps one thing for another; add-object inserts something new; isolate-subject removes everything except the main subject; outpaint extends the canvas outward; generative-fill invents content for a described region; relight changes lighting/time of day; style-transfer or cartoon restyles; sketch-to-photo makes a drawing photorealistic; upscale/enhance change resolution or quality only.
- Emit "clarification" (and an empty steps array) ONLY when the request names no achievable outcome at all — for example "make it better". If a reasonable default exists, plan the step instead of asking.
- Emit "reply" (and an empty steps array) for questions and conversation that are not edit requests.
- Keep every "label" under 24 characters, present tense, e.g. "Making it pink".
- Never invent steps the user did not ask for. Two requested changes means exactly two steps.`;

/**
 * Turns free-form text into an ordered plan, using the conversation so far to
 * resolve follow-ups ("now make it pink") against what was already done.
 *
 * Returns null when Gemini is unavailable or answers unusably — the caller
 * falls back to the deterministic client-side classifier, so planning is an
 * enhancement and never a dependency.
 */
export const planEditWithGemini = async (
  prompt: string,
  history: Array<{ role: "user" | "assistant"; text: string }> = [],
  signal?: AbortSignal,
): Promise<EditPlan | null> => {
  if (!geminiPlanningReady()) return null;

  for (const model of availableModels(TEXT_MODELS)) {
    const plan = await planWithModel(model, prompt, history, signal);
    if (plan) return plan;
  }
  return null;
};

const planWithModel = async (
  model: string,
  prompt: string,
  history: Array<{ role: "user" | "assistant"; text: string }>,
  signal?: AbortSignal,
): Promise<EditPlan | null> => {
  try {
    const payload = await callGemini(
      model,
      {
        systemInstruction: { parts: [{ text: PLANNER_SYSTEM }] },
        contents: [
          // Recent turns only. The planner needs the thread to resolve "it",
          // not the whole session, and a long tail of history mostly adds
          // latency and chances to anchor on a superseded instruction.
          ...history.slice(-8).map((turn) => ({
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.text }],
          })),
          { role: "user", parts: [{ text: prompt }] },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: PLAN_SCHEMA,
          // Planning is a parsing task, not a creative one — near-deterministic
          // output means the same sentence decomposes the same way every time.
          temperature: 0,
        },
      },
      TEXT_TIMEOUT_MS,
      signal,
    );

    const raw = partsOf(payload)
      .map((p) => p.text)
      .filter((t): t is string => typeof t === "string")
      .join("");
    if (!raw.trim()) return null;

    const parsed = JSON.parse(raw);
    const steps: PlannedStep[] = Array.isArray(parsed?.steps)
      ? parsed.steps
          .filter(
            (s: any) =>
              s &&
              typeof s.prompt === "string" &&
              s.prompt.trim() &&
              (PLANNABLE_INTENTS as readonly string[]).includes(s.intent),
          )
          .map((s: any) => ({
            intent: s.intent,
            prompt: String(s.prompt).trim(),
            label: String(s.label || "Editing").trim().slice(0, 32),
          }))
      : [];

    const clarification =
      typeof parsed?.clarification === "string" && parsed.clarification.trim()
        ? parsed.clarification.trim()
        : undefined;
    const reply =
      typeof parsed?.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : undefined;

    // Nothing usable in any field — let the deterministic classifier own it
    // rather than returning an empty plan the caller would read as "no edit".
    if (!steps.length && !clarification && !reply) return null;

    return { steps, clarification, reply };
  } catch (error: any) {
    // Planning is best-effort. A failure here must not fail the edit: the
    // caller degrades to keyword classification, which handles single-step
    // requests perfectly well.
    console.warn(`[GEMINI] planning failed (${error?.message}) — using local classifier`);
    return null;
  }
};
