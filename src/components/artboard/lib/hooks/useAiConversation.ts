import { useCallback, useEffect, useRef, useState } from "react";
import type { AiEditOptions, AiIntentId, BoardCommand, BoardCommandResult } from "../ai";
import { INTENT_VERBS, analyzePrompt, parseBoardCommands, planEdit, splitSequence } from "../ai";
import type { AiEditOutcome, AiGenerateRequest } from "./useAiEdit";

/** What a caller can attach to a prompt beyond its text. */
export interface AiSendOptions {
  /** Forces a specific intent, bypassing planning (quick-action chips). */
  intentOverride?: AiIntentId;
  /** Structured parameters, e.g. the colour picked with the eyedropper. */
  options?: AiEditOptions;
}

export type AiMessageRole = "user" | "assistant";
export type AiMessageStatus = "pending" | "done" | "error" | "canceled";

export interface AiMessage {
  id: string;
  role: AiMessageRole;
  text: string;
  status: AiMessageStatus;
  at: number;
}

let messageSeq = 0;
const nextId = () => `m${Date.now().toString(36)}-${messageSeq++}`;

/**
 * Completion lines, per intent.
 *
 * Two problems with a single fixed string. It says nothing — "your image is
 * updated" is true of every edit, so it confirms the request was received
 * rather than what came back. And repeating it verbatim down the thread makes
 * successive edits indistinguishable at a glance, which is exactly when the
 * user is scanning for which attempt did what.
 *
 * So: name the operation, and rotate phrasing so consecutive runs of the same
 * intent don't stack identical lines. Rotation is by index rather than random —
 * random repeats itself roughly a third of the time on a three-item list.
 */
const COMPLETION_COPY: Record<AiIntentId, string[]> = {
  "remove-bg": ["Background removed.", "Cut out — background is gone.", "Subject isolated."],
  "remove-color": ["Colour removed.", "That colour is gone.", "Stripped that colour out."],
  "make-transparent": ["Background is transparent now.", "Dropped to transparency."],
  "to-sticker": ["Sticker cut, border added.", "Die-cut sticker ready.", "Contour border applied."],
  "isolate-subject": ["Everything else removed.", "Just the subject now.", "Scene cleared around it."],
  upscale: ["Upscaled.", "Resolution increased.", "Bigger, with detail intact."],
  enhance: ["Quality lifted.", "Sharpened and cleaned up.", "Detail enhanced."],
  "replace-bg": ["Background replaced.", "New scene dropped in behind.", "Backdrop swapped."],
  "change-color": ["Recoloured.", "New colour applied.", "Colour swapped."],
  "remove-object": ["Object removed.", "Erased, and the gap filled in.", "Gone — area rebuilt."],
  "replace-object": ["Swapped out.", "Replaced.", "New one's in its place."],
  "add-object": ["Added.", "That's in the image now.", "Dropped it in."],
  "add-shadow": ["Shadow added.", "Drop shadow applied.", "Grounded with a shadow."],
  relight: ["Relit.", "New lighting applied.", "Light reworked."],
  outpaint: ["Image expanded.", "Scene extended outwards.", "More canvas generated."],
  "generative-fill": ["Filled in.", "Area rebuilt.", "Gap generated."],
  "style-transfer": ["Restyled.", "New style applied.", "Reimagined."],
  "sketch-to-photo": ["Rendered as a photo.", "Sketch made photoreal.", "Now photographic."],
  cartoon: ["Restyled.", "New style applied.", "Reimagined."],
  custom: ["Done.", "Edit applied.", "That's in."],
};

/** Intents whose whole point is resolution — worth quoting the actual number. */
const REPORTS_PIXELS: AiIntentId[] = ["upscale", "enhance"];

const buildCompletionText = (
  intent: AiIntentId,
  variantIndex: number,
  outcome: AiEditOutcome,
): string => {
  const { editedCount = 1, widthPx, heightPx, stepCount = 1, awaitingReview, upsampled } = outcome;
  const options = COMPLETION_COPY[intent] ?? COMPLETION_COPY.custom;
  const parts: string[] = [];

  // A staged result is not yet on the sheet, and saying "done" about something
  // the customer still has to accept is how an edit gets lost — they read the
  // confirmation, close the panel, and the work is discarded.
  if (awaitingReview) {
    parts.push(
      stepCount > 1
        ? `Both changes are ready — compare them and hit Apply.`
        : `Ready — compare it and hit Apply.`,
    );
  } else {
    parts.push(options[variantIndex % options.length]);
    if (stepCount > 1) parts.push(`${stepCount} changes applied in order.`);
    if (editedCount > 1) parts.push(`${editedCount} images updated.`);
  }

  if (REPORTS_PIXELS.includes(intent) && widthPx && heightPx) {
    parts.push(`Now ${widthPx.toLocaleString()} × ${heightPx.toLocaleString()} px.`);
  }

  // The one quality caveat worth interrupting a success message for: the pixel
  // count is right but the detail behind it is not, and it is invisible on
  // screen at artboard zoom.
  if (upsampled) {
    parts.push("The model rendered below print resolution, so it was scaled back up — run Enhance if it looks soft.");
  }

  return parts.join(" ");
};

/**
 * Turns the one-shot edit API into a chat transcript.
 *
 * Deliberately thin: it owns *only* the message thread. All editing behaviour
 * still lives in useAiEdit, so the panel can render a conversation without the
 * edit pipeline knowing that a conversation exists.
 */
export const useAiConversation = (
  generate: (prompt: string, request?: AiGenerateRequest) => Promise<AiEditOutcome>,
  /**
   * Executes board commands (size, copies, placement, sheet settings). Optional
   * so a host that only wants image editing can omit it and every prompt falls
   * through to the model exactly as before.
   */
  runBoardCommands?: (commands: BoardCommand[]) => Promise<BoardCommandResult>,
) => {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  /**
   * The thread, for the planner.
   *
   * Held in a ref alongside the state because `send` must read the history as
   * it stands at call time. Reading it from `messages` would close over the
   * value from the render that created the callback, so a follow-up sent
   * straight after a reply would plan against a thread missing its last turn —
   * exactly the turn that says what "it" refers to.
   */
  const historyRef = useRef<AiMessage[]>([]);
  useEffect(() => {
    historyRef.current = messages;
  }, [messages]);
  // Id of the assistant placeholder currently awaiting a result.
  const pendingIdRef = useRef<string | null>(null);
  // How many times each intent has completed, so repeat runs of the same
  // operation advance to the next phrasing instead of echoing the last line.
  const variantSeqRef = useRef<Map<AiIntentId, number>>(new Map());

  const patch = useCallback((id: string, changes: Partial<AiMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...changes } : m)));
  }, []);

  const send = useCallback(
    async (prompt: string, sendOptions: AiSendOptions = {}) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      const { intentOverride, options } = sendOptions;

      const userMessage: AiMessage = {
        id: nextId(),
        role: "user",
        text: trimmed,
        status: "done",
        at: Date.now(),
      };
      // A mixed board+image request posts the user's turn while handling the
      // board half, so the image half below must not post it a second time.
      let userAlreadyPosted = false;

      /**
       * Board commands are checked before the image classifier. They resolve
       * against geometry the app already owns, so they run locally and land in
       * the same frame — no model call, no network, no cost.
       *
       * A chained request can mix the two kinds of work, though: "make it 4
       * inches wide, then remove the background" is a board command *and* an
       * image edit. So the prompt is split on its sequence markers first and
       * each fragment is routed on its own merits. Without that, the board
       * parser recognises the resize, claims the whole sentence, and the image
       * half is silently dropped — the customer gets a resized image and no
       * explanation of why the background is still there.
       *
       * A prompt with no sequence markers yields a single fragment, so the
       * ordinary single-instruction path is unchanged.
       *
       * Skipped entirely when the caller forced an intent (a quick-action chip),
       * since that is an explicit request for a specific image edit.
       */
      let imagePrompt = trimmed;

      if (runBoardCommands && !intentOverride) {
        const fragments = splitSequence(trimmed);
        const boardCommands: BoardCommand[] = [];
        const imageFragments: string[] = [];

        for (const fragment of fragments) {
          const commands = parseBoardCommands(fragment);
          // The parser is deliberately conservative — a fragment it doesn't
          // claim with certainty belongs to the pixel pipeline.
          if (commands.length) boardCommands.push(...commands);
          else imageFragments.push(fragment);
        }

        if (boardCommands.length) {
          const placeholder: AiMessage = {
            id: nextId(),
            role: "assistant",
            text: "Updating the board…",
            status: "pending",
            at: Date.now(),
          };
          setMessages((prev) => [...prev, userMessage, placeholder]);

          try {
            const result = await runBoardCommands(boardCommands);
            patch(placeholder.id, {
              text: result.message,
              status: result.ok ? "done" : "error",
            });
          } catch (err: any) {
            patch(placeholder.id, {
              text: err?.message || "That change couldn't be applied.",
              status: "error",
            });
          }

          // Board work resolves against geometry the app already owns, so it
          // lands in the same frame with no model call. Nothing left to edit
          // means we're done.
          if (imageFragments.length === 0) return;

          // Otherwise fall through to the image pipeline with only the
          // fragments the board couldn't serve. The user turn is already in the
          // thread, so it must not be added again below.
          imagePrompt = imageFragments.join(", then ");
          userAlreadyPosted = true;
        }
      }

      /**
       * Prompt understanding.
       *
       * A chip press skips it: its intent is already known exactly, and asking
       * a model to re-derive it would add a round trip to the one path that is
       * currently instant.
       *
       * Everything else is planned against the thread so far, which is what
       * makes follow-ups work — "now make it pink" is meaningless without the
       * turn that established what "it" is.
       */
      const plan = intentOverride
        ? null
        : await planEdit(
            imagePrompt,
            historyRef.current.map((m) => ({ role: m.role, text: m.text })),
          );

      const analysis = analyzePrompt(imagePrompt);
      const intent = intentOverride ?? plan?.steps[0]?.intent ?? analysis.intent;

      // Some text belongs in the conversation, not in an image model. Asking
      // for one missing detail is cheaper and produces a materially better
      // result than making the model invent a colour, object, or scene.
      const conversational = plan?.reply || plan?.clarification || analysis.reply || analysis.clarification;
      if (!intentOverride && conversational) {
        const assistantMessage: AiMessage = {
          id: nextId(),
          role: "assistant",
          text: conversational,
          status: "done",
          at: Date.now(),
        };
        setMessages((prev) =>
          userAlreadyPosted ? [...prev, assistantMessage] : [...prev, userMessage, assistantMessage],
        );
        return;
      }

      const steps = plan?.steps?.length ? plan.steps : undefined;

      // A multi-step plan is stated up front. The customer asked for two things
      // in one sentence and it is about to take twice as long; showing the
      // decomposition is what makes that wait legible rather than a stall, and
      // it also surfaces a misread plan before any model time is spent on it.
      const placeholder: AiMessage = {
        id: nextId(),
        role: "assistant",
        text:
          steps && steps.length > 1
            ? `${steps.length} steps:\n${steps.map((s, i) => `${i + 1}. ${s.label}`).join("\n")}`
            : `${INTENT_VERBS[intent]}…`,
        status: "pending",
        at: Date.now(),
      };

      pendingIdRef.current = placeholder.id;
      setMessages((prev) =>
        userAlreadyPosted ? [...prev, placeholder] : [...prev, userMessage, placeholder],
      );

      const outcome = await generate(imagePrompt, { steps, intentOverride, options });
      pendingIdRef.current = null;

      if (outcome.canceled) {
        patch(placeholder.id, { text: "Canceled.", status: "canceled" });
        return;
      }
      if (!outcome.ok) {
        patch(placeholder.id, {
          text: outcome.error || "That didn't work. Try rewording your prompt.",
          status: "error",
        });
        return;
      }

      // Prefer the intent the run actually resolved to; the local fallback only
      // matters if a provider returned without reporting one.
      const resolvedIntent = outcome.intent ?? intent;
      const variantIndex = variantSeqRef.current.get(resolvedIntent) ?? 0;
      variantSeqRef.current.set(resolvedIntent, variantIndex + 1);

      patch(placeholder.id, {
        text: buildCompletionText(resolvedIntent, variantIndex, outcome),
        status: "done",
      });
    },
    [generate, patch, runBoardCommands],
  );

  const clear = useCallback(() => {
    setMessages([]);
    pendingIdRef.current = null;
    // A fresh thread starts from the first phrasing again.
    variantSeqRef.current.clear();
  }, []);

  return { messages, send, clear };
};
