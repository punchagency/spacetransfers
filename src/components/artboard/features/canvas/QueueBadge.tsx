import { useEffect, useRef, useState } from "react";

/**
 * Images waiting behind the batch currently being processed.
 *
 * ## Why this is its own card
 *
 * It began inside the progress card, sharing the row with the bar. That was
 * wrong on both counts. The bar answers "how far through the batch am I?" and
 * its percentage only means something because it describes exactly one batch;
 * a count sitting inside the same panel invites reading the two together, as
 * though the queue were part of that progress. And a single card mixes a
 * *measured* quantity with a *pending* one, which is the same mistake as
 * folding queued files into the bar's total.
 *
 * Separating them makes the relationship legible: one panel for the batch being
 * worked, one for the work waiting. `CanvasContainer` anchors this to the
 * progress card's right edge, so the two read as a pair without ever being
 * confused for one reading.
 *
 * ## Why the count is never abbreviated
 *
 * Whatever the number is, it is shown in full. A customer who has just dropped
 * 340 files is asking precisely one question — did all of them register? —
 * and "99+" refuses to answer it. The badge widens into a pill instead, which
 * costs a few pixels of a card that is already floating over empty canvas, and
 * is the entire point of the control.
 *
 * ## What it does not do
 *
 * Nothing. It renders a number. Ordering, batching and the hand-off between
 * batches are `serialQueue`'s, unchanged and untouched by anything here.
 */

/** Kept in step with the `queueBadge*` durations in index.css. */
const QUEUE_EXIT_MS = 320;

export default function QueueBadge({ count }: { count: number }) {
  const [phase, setPhase] = useState<"hidden" | "in" | "out">(
    count > 0 ? "in" : "hidden",
  );
  // Held separately from `count` so the exit animation still has a number to
  // show after the queue has already emptied — otherwise the circle blanks a
  // frame before it starts leaving, which reads as a glitch rather than a
  // hand-off.
  const [displayCount, setDisplayCount] = useState(count);

  // Read in the effect below to decide whether there is anything to animate
  // out. A ref rather than a dependency: adding `phase` to the deps would
  // re-run the effect on the very transition it just made and restart the
  // timer, and scheduling the timer from inside a `setPhase` updater instead
  // would start two of them under StrictMode's double-invoke.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (count > 0) {
      setDisplayCount(count);
      setPhase("in");
      return;
    }
    if (phaseRef.current === "hidden") return;
    setPhase("out");
    const timer = setTimeout(() => setPhase("hidden"), QUEUE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [count]);

  if (phase === "hidden") return null;

  const leaving = phase === "out";
  const label = `${displayCount} image${displayCount === 1 ? "" : "s"} queued, waiting for the current batch to finish`;

  return (
    <div
      /*
       * Anchored to the right edge of the progress card, whatever width that
       * card resolves to — `left-full` is relative to the wrapper
       * `CanvasContainer` sizes to the card, so the gap holds even when
       * `max-w-[92vw]` narrows it.
       *
       * On a narrow viewport it moves above the card instead of running off
       * the canvas, which `overflow-hidden` would otherwise clip.
       */
      className={`pointer-events-none absolute bottom-7 left-full ml-3 max-sm:bottom-full max-sm:left-auto max-sm:right-0 max-sm:mb-2 max-sm:ml-0 ${
        leaving ? "queue-badge-out" : "queue-badge-in"
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-[#FAFCFC] px-2.5 py-2.5 backdrop-blur-sm"
        style={{
          // Same lift-plus-teal-tint as the progress card, so the two read as
          // one family rather than two unrelated floating panels.
          boxShadow:
            "0 10px 28px -8px rgba(15, 23, 42, 0.16), 0 4px 10px -4px rgba(140, 175, 171, 0.35)",
        }}
      >
        <span
          // `min-w-9` + horizontal padding: a circle at one or two digits, a
          // pill beyond that. The shape gives way before the number does.
          className="relative flex h-9 min-w-9 items-center justify-center rounded-full border-2 border-[#8CAFAB] bg-white px-2"
          style={{ boxShadow: "0 0 10px -2px rgba(140, 175, 171, 0.8)" }}
          title={label}
          aria-label={label}
        >
          {/* The ripple stops during the exit — a badge that is leaving should
              not still be asking to be watched. */}
          {!leaving && (
            <span
              className="queue-ring-pulse pointer-events-none absolute -inset-px rounded-full border-2 border-[#8CAFAB]"
              aria-hidden
            />
          )}
          <span className="text-[13px] font-bold leading-none tabular-nums text-[#4F7C77]">
            {displayCount}
          </span>
        </span>
        <span className="text-[9px] font-semibold uppercase leading-none tracking-widest text-slate-400">
          queued
        </span>
      </div>
    </div>
  );
}
