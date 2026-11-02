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

/** Intents whose whole point is resolution — worth quoting the actual number. */
const REPORTS_PIXELS: AiIntentId[] = ["upscale", "enhance"];

/**
 * The reply once an edit is ready. Every edit is staged for review, so this
 * never says "done": the result is not on the sheet until the customer applies
 * it, and a "done" is how an edit gets lost — they read it, close the panel,
 * and the work is discarded.
 */
const buildCompletionText = (intent: AiIntentId, outcome: AiEditOutcome): string => {
  const { widthPx, heightPx, stepCount = 1, upsampled, droppedSteps } = outcome;
  const parts: string[] = [
    stepCount > 1
      ? `${stepCount === 2 ? "Both" : `All ${stepCount}`} changes are ready — compare them and hit Apply.`
      : "Ready — compare it and hit Apply.",
  ];

  if (REPORTS_PIXELS.includes(intent) && widthPx && heightPx) {
    parts.push(`The result is ${widthPx.toLocaleString()} × ${heightPx.toLocaleString()} px.`);
  }

  // Surfaced rather than swallowed: a customer who asked for five things and
  // got four needs to know which one to ask for again.
  if (droppedSteps) {
    parts.push(
      `I ran the first ${stepCount} changes — that's the most I can chain at once. Send the remaining ${droppedSteps} as a follow-up.`,
    );
  }

  // The one quality caveat worth interrupting for: the pixel count is right but
  // the detail behind it is not, and it is invisible at artboard zoom.
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
   * True from the moment a prompt is sent until it is fully handled — including
   * the planning round trip before any edit starts. That trip can take seconds
   * (up to the planner's timeout), and while it ran the panel showed nothing:
   * the box cleared, no message appeared and there was no Stop button, so the
   * prompt looked lost and could be sent twice.
   */
  const [isThinking, setIsThinking] = useState(false);
  const sendSeqRef = useRef(0);
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

  const patch = useCallback((id: string, changes: Partial<AiMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...changes } : m)));
  }, []);

  const send = useCallback(
    async (prompt: string, sendOptions: AiSendOptions = {}) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      const { intentOverride, options } = sendOptions;
      const seq = ++sendSeqRef.current;
      const stale = () => seq !== sendSeqRef.current;
      setIsThinking(true);
      try {

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
      // The prompt and a working line go up before planning, not after it.
      let thinkingId: string | null = null;
      if (!intentOverride) {
        const thinking: AiMessage = {
          id: nextId(),
          role: "assistant",
          text: "Reading your request…",
          status: "pending",
          at: Date.now(),
        };
        thinkingId = thinking.id;
        pendingIdRef.current = thinking.id;
        // Read now: React runs the updater later, after the flag below is set.
        const added = userAlreadyPosted ? [thinking] : [userMessage, thinking];
        setMessages((prev) => [...prev, ...added]);
        userAlreadyPosted = true;
      }

      const plan = intentOverride
        ? null
        : await planEdit(
            imagePrompt,
            historyRef.current
              .filter((m) => m.id !== thinkingId && m.id !== userMessage.id)
              .map((m) => ({ role: m.role, text: m.text })),
          );
      if (stale()) return;

      const analysis = analyzePrompt(imagePrompt);
      const intent = intentOverride ?? plan?.steps[0]?.intent ?? analysis.intent;

      // Some text belongs in the conversation, not in an image model. Asking
      // for one missing detail is cheaper and produces a materially better
      // result than making the model invent a colour, object, or scene.
      const conversational = plan?.reply || plan?.clarification || analysis.reply || analysis.clarification;
      if (!intentOverride && conversational) {
        pendingIdRef.current = null;
        if (thinkingId) {
          patch(thinkingId, { text: conversational, status: "done" });
        } else {
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
        }
        return;
      }

      const steps = plan?.steps?.length ? plan.steps : undefined;

      // A multi-step plan is stated up front. The customer asked for two things
      // in one sentence and it is about to take twice as long; showing the
      // decomposition is what makes that wait legible rather than a stall, and
      // it also surfaces a misread plan before any model time is spent on it.
      const placeholder: AiMessage = {
        id: thinkingId ?? nextId(),
        role: "assistant",
        text:
          steps && steps.length > 1
            ? `${steps.length} steps:\n${steps.map((s, i) => `${i + 1}. ${s.label}`).join("\n")}`
            : `${INTENT_VERBS[intent]}…`,
        status: "pending",
        at: Date.now(),
      };

      pendingIdRef.current = placeholder.id;
      if (thinkingId) patch(thinkingId, { text: placeholder.text });
      else
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

      patch(placeholder.id, {
        text: buildCompletionText(resolvedIntent, outcome),
        status: "done",
      });
      } finally {
        if (!stale()) setIsThinking(false);
      }
    },
    [generate, patch, runBoardCommands],
  );

  const clear = useCallback(() => {
    setMessages([]);
    pendingIdRef.current = null;
  }, []);

  /** Stop pressed while the request is still being read (before any edit runs). */
  const stopThinking = useCallback(() => {
    sendSeqRef.current++;
    const id = pendingIdRef.current;
    if (id) patch(id, { text: "Canceled.", status: "canceled" });
    pendingIdRef.current = null;
    setIsThinking(false);
  }, [patch]);

  return { messages, send, clear, isThinking, stopThinking };
};
