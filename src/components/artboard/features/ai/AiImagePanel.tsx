import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HiOutlineSparkles } from "react-icons/hi2";
import { MdArrowUpward, MdClose } from "react-icons/md";
import { QUICK_ACTIONS, BOARD_QUICK_ACTIONS, PROMPT_SUGGESTIONS, analyzePrompt, INTENT_VERBS } from "../../lib/ai";
import type { AiEditOptions } from "../../lib/ai";
import type { AiMessage, AiSendOptions } from "../../lib/hooks/useAiConversation";
import type { AiEditStatus } from "../../lib/hooks/useAiEdit";
import AiEditHistory from "./AiEditHistory";
import ColorPickerStrip from "./ColorPickerStrip";

const PANEL_WIDTH = 384;
const GAP = 12;
const EDGE = 10;
// Keep clear of the fixed editor header the same way PropertiesPanel does.
const TOP_SAFE = 56;
// Used only for the FIRST paint, before the real height is measured; the
// above/below decision is redone from the true height on the next frame.
const ESTIMATED_HEIGHT = 300;

/**
 * How many suggestions the empty state offers.
 *
 * Picked from the full catalogue at module load rather than per render: a set
 * that reshuffled on every keystroke would be unreadable, and re-picking on
 * each panel open would make the feature feel arbitrary. Randomised once per
 * session so different examples surface across visits — the list spans board
 * commands, single edits and chained ones, and only a rotating sample gets all
 * three in front of someone in a strip four chips wide.
 */
const SUGGESTION_SAMPLE = [...PROMPT_SUGGESTIONS]
  .sort(() => Math.random() - 0.5)
  .slice(0, 4);

interface Placement {
  x: number;
  y: number;
  /** Panel sits below the image (caret points up) vs. above it (caret points down). */
  below: boolean;
  /** Horizontal caret offset within the panel, px from the panel's left edge. */
  caretX: number;
}

interface AiImagePanelProps {
  /** The selected image element the panel anchors to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Changes whenever the anchor moves (item drag, zoom, scroll) to re-measure. */
  positionKey: unknown;
  messages: AiMessage[];
  isRunning: boolean;
  status: AiEditStatus | null;
  onSend: (prompt: string, options?: AiSendOptions) => void;
  onCancel: () => void;
  onClose: () => void;
  /** Container element that will be watched for scroll events (typically the canvas). */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  /** Selected image, for colour sampling and the history thumbnails. */
  imageUrl?: string;
  /** That image's own AI edit chain, oldest first. */
  editHistory?: Array<{ prompt: string; url: string; at: number }>;
  onRevertHistory?: (entryIndex: number) => void;
}

const computePlacement = (rect: DOMRect, panelHeight: number): Placement => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Centre horizontally on the image, then clamp fully into the viewport.
  const idealX = rect.left + rect.width / 2 - PANEL_WIDTH / 2;
  const x = Math.min(Math.max(EDGE, idealX), Math.max(EDGE, vw - PANEL_WIDTH - EDGE));

  // Prefer below; flip above only when below would overflow AND above actually fits.
  const fitsBelow = rect.bottom + GAP + panelHeight + EDGE <= vh;
  const fitsAbove = rect.top - GAP - panelHeight >= TOP_SAFE;
  const below = fitsBelow || !fitsAbove;

  const y = below
    ? Math.min(rect.bottom + GAP, vh - panelHeight - EDGE)
    : Math.max(TOP_SAFE, rect.top - GAP - panelHeight);

  // Caret tracks the image centre but stays within the panel's rounded corners.
  const caretX = Math.min(
    Math.max(20, rect.left + rect.width / 2 - x),
    PANEL_WIDTH - 20,
  );

  return { x, y, below, caretX };
};

export default function AiImagePanel({
  anchorRef,
  positionKey,
  messages,
  isRunning,
  status,
  onSend,
  onCancel,
  onClose,
  scrollContainerRef,
  imageUrl,
  editHistory,
  onRevertHistory,
}: AiImagePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const [placement, setPlacement] = useState<Placement | null>(null);
  // Drives the enter/exit transition; false on first paint so it animates in.
  const [entered, setEntered] = useState(false);
  // Panel opacity during scroll: 1 when idle, 0 when actively scrolling.
  const [scrollOpacity, setScrollOpacity] = useState(1);
  const scrollTimeoutRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  // Single source of truth for repositioning: read the anchor + the panel's
  // REAL measured height (the full panel is always mounted, so this is accurate
  // from the very first layout pass — no estimate-then-correct flicker).
  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const height = panelRef.current?.offsetHeight || ESTIMATED_HEIGHT;
    setPlacement(computePlacement(anchor.getBoundingClientRect(), height));
  }, [anchorRef]);

  // Position before the browser paints whenever the anchor could have moved
  // (item drag, zoom, scroll) or the content height could have changed.
  useLayoutEffect(() => {
    reposition();
  }, [reposition, positionKey, messages, status, isRunning]);

  // Re-anchor on window resize and on any panel height change (chips wrapping,
  // textarea auto-grow, a message arriving) that the deps above don't capture.
  useEffect(() => {
    window.addEventListener("resize", reposition);
    const ro = new ResizeObserver(reposition);
    if (panelRef.current) ro.observe(panelRef.current);
    return () => {
      window.removeEventListener("resize", reposition);
      ro.disconnect();
    };
  }, [reposition]);

  // Play the enter transition and auto-focus exactly once, after the first
  // successful positioning — guarded so later repositions (scroll, resize)
  // never re-trigger the animation or steal focus back mid-typing.
  const hasEnteredRef = useRef(false);
  useEffect(() => {
    if (!placement || hasEnteredRef.current) return;
    hasEnteredRef.current = true;
    const raf = requestAnimationFrame(() => setEntered(true));
    const focus = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(focus);
    };
  }, [placement]);

  // Animate out, then tell the parent to unmount.
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setEntered(false);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  // Esc closes; also cancels an in-flight run first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (isRunning) onCancel();
      else requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isRunning, onCancel, requestClose]);

  // Click-outside closes. The toolbar's AI toggle is exempt so its own
  // open/close handler runs alone instead of racing this one (double-close).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.("[data-ai-toggle]")) return;
      requestClose();
    };
    // Defer so the same click that opened the panel doesn't immediately close it.
    const id = window.setTimeout(
      () => document.addEventListener("mousedown", onDown, true),
      0,
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [requestClose]);

  // Hide the panel during scroll, show it again when scroll stops (debounced).
  // This reduces visual clutter and prevents the panel from jumping around while panning.
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    const onScroll = () => {
      setScrollOpacity(0);
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = window.setTimeout(() => {
        setScrollOpacity(1);
      }, 350);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [scrollContainerRef]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  // Grow the textarea with its content up to ~5 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [prompt]);

  const submit = useCallback(
    (text: string, sendOptions?: AiSendOptions) => {
      const trimmed = text.trim();
      if (!trimmed || isRunning) return;
      onSend(trimmed, sendOptions);
      setPrompt("");
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [isRunning, onSend],
  );

  /** A swatch click is a complete instruction — the colour *is* the parameter. */
  const handleRemoveColor = useCallback(
    (colorPrompt: string, options: AiEditOptions) => {
      submit(colorPrompt, { intentOverride: "remove-color", options });
    },
    [submit],
  );

  const handleChip = (action: { prompt: string; template?: string; intent?: AiSendOptions["intentOverride"] }) => {
    if (isRunning) return;
    // Templated chips need a user-supplied noun — pre-fill and let them type.
    // No intent is forced in that case: what they type may not match the chip
    // they started from, and their words should win over the chip's label.
    if (action.template) {
      setPrompt(action.template);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
      return;
    }
    // A one-click chip states its intent exactly, so it is passed through rather
    // than re-derived from the prompt text — that also skips the planning round
    // trip and keeps the chips the fastest path in the panel.
    submit(action.prompt, action.intent ? { intentOverride: action.intent } : undefined);
  };

  const pct = status ? Math.max(0, Math.min(100, status.progress.pct)) : 0;
  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages],
  );
  const hasError = lastAssistant?.status === "error";
  const promptAnalysis = useMemo(() => analyzePrompt(prompt), [prompt]);

  // The panel is ALWAYS mounted so its real height is measurable from the first
  // layout pass; until positioned it sits offscreen at opacity 0 (no flash).
  const positioned = placement !== null;
  const below = placement?.below ?? true;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Edit image with AI"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: positioned ? placement!.x : -9999,
        top: positioned ? placement!.y : -9999,
        width: PANEL_WIDTH,
        maxWidth: "calc(100vw - 20px)",
        zIndex: 3000,
        opacity: entered ? scrollOpacity : 0,
        transform: entered
          ? "translateY(0) scale(1)"
          : `translateY(${below ? -8 : 8}px) scale(0.98)`,
        transformOrigin: below ? "top center" : "bottom center",
        transition:
          "opacity 220ms cubic-bezier(0.22,1,0.36,1), transform 240ms cubic-bezier(0.22,1,0.36,1)",
        pointerEvents: scrollOpacity === 0 ? "none" : "auto",
      }}
      // Plain white on a gray border with a standard shadow, matching the
      // Header tooltips and Sidebar surfaces. The translucent glass panel and
      // layered custom shadow belonged to no other surface in the app.
      className="rounded-2xl border border-gray-200 bg-white shadow-xl"
    >
      {/* Caret tying the panel to the image. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: (placement?.caretX ?? PANEL_WIDTH / 2) - 6,
          [below ? "top" : "bottom"]: -6,
          width: 12,
          height: 12,
        }}
        className="rotate-45 rounded-[2px] border border-gray-200 bg-white"
      />

      {/* Header */}
      <div className="relative flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        {/* slate-900, the same primary the rest of the app uses for toggles,
            submit buttons and the avatar — not a purple gradient. */}
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
          <HiOutlineSparkles className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 leading-tight">
          <div className="text-[13px] font-semibold text-gray-900">Edit with AI</div>
          <div className="text-[11px] text-gray-400">Change the artwork or the sheet — try “what can you do?”</div>
        </div>
        <button
          onClick={requestClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-95 transition"
        >
          <MdClose className="h-4 w-4" />
        </button>
      </div>

      {/* Conversation — only rendered once there's history, so an empty panel
          stays compact and input-focused. */}
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-[168px] overflow-y-auto px-4 py-1 space-y-2 scroll-smooth"
        >
          {messages.map((m) => (
            <Message key={m.id} message={m} pct={pct} runningPhase={status?.progress.phase} />
          ))}
        </div>
      )}

      {/* Colour removal, driven by the artwork's own dominant colours so the
          operation is a single click on a real colour instead of a description
          of one. Only shown while idle — the swatches are for starting an edit,
          and leaving them live mid-run invites a second one. */}
      {imageUrl && !isRunning && (
        <ColorPickerStrip imageUrl={imageUrl} onRemove={handleRemoveColor} disabled={isRunning} />
      )}

      {/* Quick-action chips.
          Board actions lead: on a gang sheet, sizing and copy counts are the
          everyday operations, while image edits are occasional. They are also
          tinted differently because they behave differently — board commands
          apply instantly and locally, image edits call out to a model. */}
      <div className="px-4 pt-2">
        <div className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {BOARD_QUICK_ACTIONS.map((action) => (
            <button
              key={`board-${action.label}`}
              onClick={() => handleChip(action)}
              disabled={isRunning}
              title={action.hint}
              className="flex-shrink-0 rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:border-slate-300 hover:bg-gray-200 hover:text-slate-900 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
            >
              {action.label}
            </button>
          ))}
          <span aria-hidden className="flex-shrink-0 self-center h-4 w-px bg-gray-200" />
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.intent}
              onClick={() => handleChip({ ...action, intent: action.intent })}
              disabled={isRunning}
              title={action.hint}
              className="flex-shrink-0 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:border-slate-300 hover:bg-gray-50 hover:text-slate-900 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input row */}
      <div className="px-3 pb-3 pt-1">
        <div
          className={`flex items-end gap-2 rounded-xl border bg-white px-3 py-2 transition-colors ${
            hasError ? "border-red-200" : "border-gray-200 focus-within:border-slate-400"
          }`}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={prompt}
            disabled={isRunning}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(prompt);
              }
            }}
            placeholder="Describe how you'd like to edit this image…"
            aria-label="Describe how you'd like to edit this image"
            className="min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-snug text-gray-800 placeholder:text-gray-400 focus:outline-none disabled:opacity-60"
          />

          {isRunning ? (
            <button
              onClick={onCancel}
              aria-label="Cancel generation"
              className="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-200 active:scale-95 transition"
            >
              <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => submit(prompt)}
              disabled={!prompt.trim()}
              aria-label="Generate"
              className="group flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-slate-800 hover:shadow-md active:scale-95 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
            >
              Generate
              <MdArrowUpward className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <p
          className={`mt-1.5 px-1 text-[10.5px] leading-snug ${
            promptAnalysis.clarification ? "text-amber-700" : "text-gray-400"
          }`}
        >
          {prompt.trim()
            ? promptAnalysis.clarification || promptAnalysis.reply ||
              `Ready to ${INTENT_VERBS[promptAnalysis.intent].toLowerCase()} this image while preserving its layout and text.`
            : "Be specific for the best result — mention the subject, colour, style, or background you want."}
        </p>

        {/* Prompt suggestions, shown only on an empty box in a fresh thread.
            They are for discovery — most people never try a chained "then"
            instruction, or a board command, unless they've seen one work — and
            once there's history the panel should be about the conversation. */}
        {!prompt.trim() && messages.length === 0 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SUGGESTION_SAMPLE.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => submit(suggestion)}
                disabled={isRunning}
                className="flex-shrink-0 rounded-lg border border-dashed border-gray-200 px-2 py-1 text-[10.5px] text-gray-500 transition-all duration-150 hover:border-slate-300 hover:bg-gray-50 hover:text-slate-800 active:scale-95 disabled:opacity-40"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* Running progress bar under the input. */}
        {isRunning && status && (
          <div className="mt-2 px-0.5">
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span className="truncate">{status.progress.phase}</span>
              <span className="ml-2 flex-shrink-0 font-semibold text-slate-900 tabular-nums">
                {/* Both counters when both apply: which image of the batch, and
                    which step of the plan. A single "45%" during a two-step edit
                    on eight images tells the customer nothing about the wait. */}
                {status.total > 1 ? `${status.index}/${status.total} · ` : ""}
                {status.stepCount && status.stepCount > 1
                  ? `step ${status.stepIndex}/${status.stepCount} · `
                  : ""}
                {Math.round(pct)}%
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-slate-900 transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* This image's own edit chain, with revert. Below the input because it is
          a reference and a recovery path, not part of composing a new prompt. */}
      {imageUrl && onRevertHistory && editHistory && editHistory.length > 0 && (
        <AiEditHistory
          entries={editHistory}
          currentUrl={imageUrl}
          onRevert={onRevertHistory}
          disabled={isRunning}
        />
      )}
    </div>,
    document.body,
  );
}

/** One transcript row: user prompt (right, filled) or assistant reply (left). */
function Message({
  message,
  pct,
  runningPhase,
}: {
  message: AiMessage;
  pct: number;
  runningPhase?: string;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-3 py-1.5 text-[12px] leading-snug text-white">
          {message.text}
        </div>
      </div>
    );
  }

  // Only failure gets a colour. Everything else sits on the same neutral
  // surface the rest of the app uses for panels and rows — a green "success"
  // bubble on every reply is what made this read as a bolted-on chatbot rather
  // than part of the editor. Status still reads clearly from the leading icon.
  const tone =
    message.status === "error"
      ? "bg-red-50 text-red-700 border-red-100"
      : message.status === "canceled"
      ? "bg-gray-50 text-gray-400 border-gray-100"
      : "bg-gray-50 text-gray-700 border-gray-200";

  return (
    <div className="flex justify-start">
      {/* items-start + pre-line, not items-center + truncate: replies can be
          multi-line (the capability list answering "what can you do?"), and
          `truncate` sets white-space:nowrap, which would flatten the whole
          list into one ellipsised line. */}
      <div
        className={`flex max-w-[88%] items-start gap-2 rounded-2xl rounded-bl-md border px-3 py-1.5 text-[12px] leading-snug ${tone}`}
      >
        {message.status === "pending" && (
          <span className="mt-0.5 h-3 w-3 flex-shrink-0 rounded-full border-2 border-gray-300 border-t-slate-900 animate-spin" />
        )}
        {message.status === "done" && (
          <HiOutlineSparkles className="mt-px h-3.5 w-3.5 flex-shrink-0 text-slate-900" />
        )}
        <span className="min-w-0 whitespace-pre-line break-words">
          {message.status === "pending" && runningPhase ? `${runningPhase} · ${Math.round(pct)}%` : message.text}
        </span>
      </div>
    </div>
  );
}
