import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HiOutlineSparkles } from "react-icons/hi2";
import { MdCheck, MdClose, MdRefresh } from "react-icons/md";
import BeforeAfterSlider from "./BeforeAfterSlider";
import type { AiPreview } from "../../lib/hooks/useAiEdit";

/**
 * Review gate for a finished AI edit.
 *
 * Nothing has touched the artboard at this point — the customer accepts or
 * discards. Two reasons this exists rather than applying straight away and
 * relying on undo. A generative edit is non-deterministic, so judging it is a
 * human step that has to happen *somewhere*; and at artboard zoom the defects
 * that matter for a transfer print (a fringe on a cutout, a colour a shade off,
 * a re-rendered word) are invisible, so the judgement has to happen at a
 * useful size.
 */

/** A yes/no choice about how the edit is made, changed without leaving the review. */
export interface ReviewOption {
  label: string;
  hint: string;
  checked: boolean;
  /** Set, with the reason in `hint`, when the choice has no effect on this image. */
  disabled?: boolean;
  /** Re-runs the edit the other way; the dialog shows the new result when it lands. */
  onChange: (checked: boolean) => void;
}

interface AiPreviewDialogProps {
  /** What to compare. An AI edit passes its whole preview; any other edit passes these fields. */
  preview: Pick<AiPreview, "beforeUrl" | "afterUrl" | "prompt" | "steps" | "result">;
  onApply: () => void;
  onDiscard: () => void;
  /** Re-runs the same prompt for a different sample. Left out for an edit with one right answer. */
  onRetry?: () => void;
  isRunning: boolean;
  /** Shown as plain text under the title, in place of the quoted prompt. */
  caption?: string;
  option?: ReviewOption;
}

export default function AiPreviewDialog({
  preview,
  onApply,
  onDiscard,
  onRetry,
  isRunning,
  caption,
  option,
}: AiPreviewDialogProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Enter applies, Escape discards. Capture phase so the artboard's own
  // Escape handler doesn't close the panel underneath this dialog first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isRunning) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onDiscard();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.stopPropagation();
        onApply();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isRunning, onApply, onDiscard]);

  const { result, steps, prompt } = preview;
  const megapixels = (result.widthPx * result.heightPx) / 1_000_000;

  return createPortal(
    <div
      // The AI panel treats clicks in here as its own (see its click-outside).
      data-ai-review
      className="fixed inset-0 z-[4000] flex items-center justify-center p-4"
      style={{
        background: "rgba(15,23,42,0.45)",
        opacity: entered ? 1 : 0,
        transition: "opacity 180ms ease-out",
      }}
      onMouseDown={(e) => {
        // Backdrop click discards, but only the backdrop itself — a mouseup that
        // drifts off the comparison slider must not throw the edit away.
        if (e.target === e.currentTarget && !isRunning) onDiscard();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review the AI edit"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        style={{
          transform: entered ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
          transition: "transform 220ms cubic-bezier(0.22,1,0.36,1)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <HiOutlineSparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[13px] font-semibold text-gray-900">Review the edit</div>
            {/* The prompt is echoed because the panel behind is covered — without
                it there is nothing on screen saying what was asked for. */}
            <div className="truncate text-[11px] text-gray-400" title={caption ?? prompt}>
              {caption ?? `“${prompt}”`}
            </div>
          </div>
          <button
            onClick={onDiscard}
            disabled={isRunning}
            aria-label="Discard"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 active:scale-95 disabled:opacity-40"
          >
            <MdClose className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <BeforeAfterSlider beforeUrl={preview.beforeUrl} afterUrl={preview.afterUrl} />

          <p className="mt-2 text-center text-[10.5px] text-gray-400">
            Drag or click to compare · ← → to nudge
          </p>

          {/* A choice about how the edit is made, here where its effect can be
              seen — flipping it re-runs the edit and the comparison updates. */}
          {option && (
            <label
              className={`mt-2 flex items-start gap-2.5 rounded-xl border border-gray-200 px-3 py-2.5 ${
                option.disabled || isRunning ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-50"
              }`}
            >
              <input
                type="checkbox"
                checked={option.checked}
                disabled={option.disabled || isRunning}
                onChange={(e) => option.onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300"
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-gray-900">
                  {option.label}
                  {isRunning && <span className="ml-2 font-normal text-gray-400">Updating…</span>}
                </span>
                <span className="block text-[11px] leading-snug text-gray-500">{option.hint}</span>
              </span>
            </label>
          )}

          {/* Steps, when there was more than one. A chained edit that came back
              wrong is usually wrong at one specific step, and this is what tells
              the customer which one to re-word. */}
          {steps.length > 1 && (
            <ol className="mt-2 space-y-1 rounded-xl bg-gray-50 px-3 py-2">
              {steps.map((step, i) => (
                <li key={`${step.intent}-${i}`} className="flex items-start gap-2 text-[11px] text-gray-600">
                  <span className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="min-w-0 break-words">{step.prompt}</span>
                </li>
              ))}
            </ol>
          )}

          {/* Resolution and provenance. `upsampled` is called out because it is
              the one problem a customer cannot see here: the pixel count is
              real, the detail behind it is not, and it only shows up in print. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-gray-400">
            <span className="tabular-nums">
              {result.widthPx.toLocaleString()} × {result.heightPx.toLocaleString()} px
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{megapixels.toFixed(1)} MP</span>
            {result.model && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{result.model}</span>
              </>
            )}
          </div>

          {result.upsampled && (
            <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-800">
              The model rendered below your artwork's resolution, so it was scaled back up to keep
              the print size and DPI. Detail may look soft — run <strong>Enhance quality</strong> after
              applying.
            </p>
          )}
        </div>

        {/* Actions. Apply is primary and on the right, matching the submit button
            in the panel this replaces. */}
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 px-4 py-3">
          {onRetry && (
            <button
              onClick={onRetry}
              disabled={isRunning}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MdRefresh className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
              Try again
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onDiscard}
            disabled={isRunning}
            className="flex h-9 items-center rounded-lg px-3 text-[12px] font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 active:scale-95 disabled:opacity-40"
          >
            Discard
          </button>
          <button
            onClick={onApply}
            disabled={isRunning}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-slate-800 hover:shadow-md active:scale-95 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
          >
            <MdCheck className="h-4 w-4" />
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
