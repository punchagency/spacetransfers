import { apiFetch } from "../../../../lib/utils/api";
import { INTENT_VERBS, analyzePrompt, classifyPrompt } from "./intents";
import type { AiIntentId } from "./types";

/**
 * Prompt understanding.
 *
 * Converts one sentence into an ordered list of atomic edits. "Make the rabbit
 * pink, then add a birthday hat" is two model calls, not one — asking a single
 * generative pass to do both reliably produces one of them and quietly drops
 * the other, and the customer cannot tell which half failed.
 *
 * Two tiers, and the split matters for reliability:
 *
 *  - **Server (Gemini text model).** Understands intent, resolves "it" and
 *    "the rabbit" against the conversation so far, and rewrites each step into
 *    a self-contained instruction. This is what makes follow-up refinement work
 *    without starting over.
 *  - **Local.** A deterministic split on explicit sequence markers plus the
 *    existing keyword classifier. No network, no key, no cost.
 *
 * The local tier is a real fallback rather than a stub: single-step requests —
 * the overwhelming majority — classify identically either way, so an
 * unreachable planner costs referential resolution and nothing else.
 */

export interface PlanStep {
  intent: AiIntentId;
  /** Self-contained instruction for this step alone. */
  prompt: string;
  /** Short present-tense label for the progress UI. */
  label: string;
}

export interface EditPlan {
  steps: PlanStep[];
  /** One missing detail worth asking for instead of letting the model guess. */
  clarification?: string;
  /** Conversational answer for prompts that aren't edit requests. */
  reply?: string;
  /** True when the server planner produced this, false when derived locally. */
  planned: boolean;
}

export interface PlannerTurn {
  role: "user" | "assistant";
  text: string;
}

const SEQUENCE_SPLIT = /\s*(?:,\s*)?\b(?:then|and then|after that|next|followed by|finally)\b\s*/i;

/** Rough ceiling on a locally-derived plan, mirroring the runtime step cap. */
const MAX_LOCAL_STEPS = 4;

/**
 * Splits a prompt on explicit sequence markers, or returns it whole.
 *
 * Exported because the conversation layer needs the same split *before* it
 * decides whether a prompt is a board command or an image edit. "Make it 4
 * inches wide, then remove the background" is one of each, and without splitting
 * first the board parser claims the sentence on its resize clause and the image
 * half is silently discarded.
 */
export const splitSequence = (prompt: string): string[] => {
  const parts = prompt
    .split(SEQUENCE_SPLIT)
    .map((part) => part.trim().replace(/^[,;]\s*/, ""))
    .filter(Boolean);
  // A fragment too short to be an instruction is a false split ("then" inside a
  // phrase, a trailing "and then"). Fall back to the whole prompt.
  if (parts.length < 2 || parts.some((p) => p.length < 4)) return [prompt];
  return parts.slice(0, MAX_LOCAL_STEPS);
};

/** Derives a plan with no network — the fallback, and the fast path for chips. */
export const planLocally = (prompt: string): EditPlan => {
  const trimmed = prompt.trim();
  const analysis = analyzePrompt(trimmed);

  // A help question or a genuinely underspecified request is answered in the
  // thread; neither should reach an image model.
  if (analysis.reply || analysis.clarification) {
    return {
      steps: [],
      reply: analysis.reply,
      clarification: analysis.clarification,
      planned: false,
    };
  }

  const fragments = splitSequence(trimmed);
  return {
    steps: fragments.map((fragment) => {
      const intent = classifyPrompt(fragment);
      return { intent, prompt: fragment, label: INTENT_VERBS[intent] };
    }),
    planned: false,
  };
};

/**
 * Availability cache for the planner.
 *
 * Mirrors the server provider's split between a definitive answer and a
 * transport failure, and for the same reason: caching a failed probe as though
 * it were a real "no" once left the whole generative feature dark for an entire
 * session when the API merely happened to be slow to come up at page load.
 */
const DEFINITIVE_TTL_MS = 5 * 60_000;
const FAILURE_BACKOFF_MS = 30_000;

let plannerAvailable: { value: boolean; at: number; definitive: boolean } | null = null;

const plannerIsFresh = (): boolean => {
  if (!plannerAvailable) return false;
  const ttl = plannerAvailable.definitive ? DEFINITIVE_TTL_MS : FAILURE_BACKOFF_MS;
  return Date.now() - plannerAvailable.at < ttl;
};

/**
 * Plans an edit, preferring the server planner and degrading silently.
 *
 * Never rejects. A planning failure must not become an editing failure — the
 * customer asked for an image edit, not for a plan, so any problem here resolves
 * to the local plan and the edit proceeds.
 */
export const planEdit = async (
  prompt: string,
  history: PlannerTurn[] = [],
  signal?: AbortSignal,
): Promise<EditPlan> => {
  const trimmed = prompt.trim();
  if (!trimmed) return { steps: [], planned: false };

  const local = planLocally(trimmed);

  // Help text and clarifications are resolved locally and authoritatively —
  // they need no model, and spending a round trip to be told the same thing
  // just makes the panel feel slow.
  if (local.reply || local.clarification) return local;

  if (plannerIsFresh() && !plannerAvailable!.value) return local;

  try {
    const response = await apiFetch("/customer/assets/ai-edit/plan", {
      method: "POST",
      body: JSON.stringify({
        prompt: trimmed,
        // Only the recent thread: enough to resolve "it", not enough to anchor
        // on an instruction that has since been superseded.
        history: history.slice(-8).map((turn) => ({ role: turn.role, text: turn.text })),
      }),
      signal,
    });

    plannerAvailable = { value: Boolean(response?.planned), at: Date.now(), definitive: true };

    if (!response?.planned) return local;

    const steps: PlanStep[] = Array.isArray(response.steps)
      ? response.steps
          .filter((s: any) => s && typeof s.prompt === "string" && s.prompt.trim())
          .map((s: any) => {
            // The server validates against its own intent list, but that list
            // and this union are maintained separately. Anything unrecognised
            // becomes `custom` — which still runs, just without per-intent
            // tuning — rather than indexing INTENT_VERBS with a missing key.
            const intent: AiIntentId =
              s.intent && s.intent in INTENT_VERBS ? (s.intent as AiIntentId) : "custom";
            return {
              intent,
              prompt: String(s.prompt).trim(),
              label: String(s.label || INTENT_VERBS[intent]).trim(),
            };
          })
      : [];

    const clarification =
      typeof response.clarification === "string" && response.clarification.trim()
        ? response.clarification.trim()
        : undefined;
    const reply =
      typeof response.reply === "string" && response.reply.trim()
        ? response.reply.trim()
        : undefined;

    // A planned response with nothing actionable in it would stall the panel.
    if (!steps.length && !clarification && !reply) return local;

    return { steps, clarification, reply, planned: true };
  } catch (error: any) {
    // A cancel is the caller's business, not a planner failure — re-throw so the
    // run aborts instead of proceeding with a plan nobody is waiting for.
    if (error?.name === "AbortError" || signal?.aborted) throw error;
    plannerAvailable = { value: false, at: Date.now(), definitive: false };
    return local;
  }
};
