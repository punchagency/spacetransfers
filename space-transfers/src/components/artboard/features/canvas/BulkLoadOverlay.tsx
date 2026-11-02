interface BulkLoadOverlayProps {
  /** Images fully processed and placed on the board. */
  loaded: number;
  /** Total images in the current batch. */
  total: number;
  /** Cancels the in-flight batch. */
  onCancel?: () => void;
}

const ImagesIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="3" y="3" width="13" height="13" rx="2.5" />
    <path d="M8.5 21h10a2.5 2.5 0 0 0 2.5-2.5v-10" />
  </svg>
);

export default function BulkLoadOverlay({
  loaded,
  total,
  onCancel,
}: BulkLoadOverlayProps) {
  if (total <= 0) return null;

  const safeLoaded = Math.max(0, Math.min(loaded, total));
  const pct = total > 0 ? (safeLoaded / total) * 100 : 0;

  return (
    <div
      // `pointer-events-none` on the shell with `pointer-events-auto` on the
      // button only: the customer can keep dragging, selecting and zooming
      // artwork underneath while the rest of the batch lands.
      className="pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-[#FAFCFC] px-4 py-3.5 backdrop-blur-sm"
        style={{
          // A neutral shadow for lift plus a faint teal-tinted one underneath —
          // ties the card to the brand fill colour without tinting the card
          // itself, which would fight the icon badge and bar for attention.
          boxShadow:
            "0 10px 28px -8px rgba(15, 23, 42, 0.16), 0 4px 10px -4px rgba(140, 175, 171, 0.35)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            {/* The glow pulse lives on the badge, not the text — a quiet sign
                the app is actively working, kept off anything the customer
                has to read. */}
            <div className="animate-pulse-glow mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6FA09B] to-[#8CAFAB]">
              <ImagesIcon />
            </div>
            <div className="min-w-0">
              {/* The count leads, because "how far along is it" is the question
                  that decides whether to wait — and it is now the title rather
                  than a footnote under the bar. */}
              <p className="text-[13px] font-semibold leading-5 tabular-nums text-slate-900">
                Processing {safeLoaded} of {total} images
              </p>
              <p className="mt-0.5 text-[11.5px] leading-[15px] text-slate-500">
                Please wait until the current upload finishes before adding more images.
              </p>
            </div>
          </div>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="pointer-events-auto shrink-0 text-[11px] font-semibold text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>

        {/* Full width, and reporting only the active batch. Queued images are
            deliberately not represented here — they are a different quantity,
            and folding them in would make the percentage mean nothing. They
            have their own card (see `QueueBadge`). */}
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="animate-pulse-glow relative h-full overflow-hidden rounded-full bg-gradient-to-r from-[#75A19C] to-[#8CAFAB] transition-[width] duration-[420ms] ease-out"
            style={{ width: `${pct}%` }}
          >
            {/* Travelling highlight, reinforcing "still working" without
                pulling attention the way a bright flash would. */}
            <div className="processing-bar-sheen absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          </div>
        </div>

        <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[12px] tabular-nums text-slate-600">
          {/* Only shown once something is actually waiting, so the card stays a
              plain progress readout in the ordinary single-batch case. Saying
              the queued files start automatically is the part that stops a
              customer re-dropping them. */}
          <span className="min-w-0 truncate">Images are still processing</span>
          <span className="shrink-0 font-semibold text-[#5C8B86]">{Math.round(pct)}%</span>
        </div>
      </div>
    </div>
  );
}
