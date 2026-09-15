import { transparencyMessage, type FadeVerdict } from "../../lib/utils/fadeCheck";

interface ArtboardWarningProps {
  /**
   * The verdict behind each flagged image on the board, one per image. The
   * count is its length; when a single image is flagged its own explanation is
   * shown, which is far more actionable than the generic sentence.
   */
  flagged?: FadeVerdict[];
}

/**
 * Confidence badge.
 *
 * Shown because the check is now a judgement rather than a pixel count, and a
 * customer deciding whether to re-export their artwork deserves to know how
 * sure it is. Only rendered for AI verdicts: the heuristic's "confidence" is a
 * fixed constant per branch, and dressing that up as a measured probability
 * would imply a precision it does not have.
 */
function ConfidenceBadge({ confidence, source }: { confidence: number; source: string }) {
  if (source !== "ai") return null;
  return (
    <span
      className="shrink-0 rounded-[3px] border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-500"
      title="How confident the AI fade check is in this result"
    >
      {Math.round(confidence * 100)}% confident
    </span>
  );
}

/**
 * Fade mark.
 *
 * Fade keeps a warning triangle where DPI does not, and keeps its colour in the
 * glyph rather than in a dot. That asymmetry is deliberate and is the banner's
 * only severity signal: DTF physically cannot reproduce a fade, so the sheet
 * will come off the press wrong, whereas low DPI prints — just softer. Giving
 * both the same weight is what made the old all-amber treatment unreadable as a
 * priority ordering.
 */
const FadeMark = (
  <svg
    className="shrink-0 text-orange-600"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/**
 * The banner shell every variant renders through.
 *
 * Square, full-bleed, and docked. This is a flex child of the artboard column
 * rather than an overlay, so it spans the full canvas width — at that width a
 * rounded, shadowed card floating inside a bordered strip read as a dialog that
 * had failed to centre itself. A hairline bottom border and a 1px lift instead
 * make it structural: a status strip belonging to the canvas beneath it.
 *
 * Content is centred on both axes. The mark and title sit on one centred line
 * so they form a single optical unit, and the body is capped at 720px so a long
 * sentence wraps into a readable measure instead of stretching to the full
 * sheet width and losing its centre.
 */
function NoticeBanner({
  mark,
  title,
  body,
  trailing,
}: {
  mark: React.ReactNode;
  title: string;
  body: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      // `polite`: none of these states blocked the customer's work, so none
      // should interrupt a screen reader mid-sentence.
      aria-live="polite"
      className="pointer-events-auto w-full border-b border-slate-200 bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
    >
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-1 text-center">
        <div className="flex items-center justify-center gap-1.5">
          {mark}
          <p className="text-[13px] font-semibold leading-none tracking-tight text-slate-900">
            {title}
          </p>
          {trailing}
        </div>
        <p className="text-[12px] leading-[17px] text-slate-600">{body}</p>
      </div>
    </div>
  );
}

/**
 * The docked fade banner.
 *
 * Resolution used to share this component, which forced a third "Print Issues
 * Detected" variant whenever both conditions held at once. That merge is gone:
 * low DPI is now a toast in the shared notice queue (see `showLowDpiWarning`),
 * so a sheet with both a fade and soft artwork shows two independent notices
 * rather than one sentence trying to carry both.
 *
 * Fade stays docked rather than joining the queue because the two are not the
 * same kind of statement. A fade cannot be printed at all — the sheet comes off
 * the press wrong — so it has to remain on screen for as long as the offending
 * artwork is on the board, which a timed toast cannot express.
 */
export default function ArtboardWarning({ flagged = [] }: ArtboardWarningProps) {
  const count = flagged.length;
  if (count === 0) return null;

  // The specific explanation is only unambiguous for a single flagged image.
  // With several, each may have been flagged for a different reason, and
  // showing one image's would misattribute it to the rest.
  const sole = count === 1 ? transparencyMessage(flagged[0]) : null;
  // Weakest link: the banner should not claim more certainty than its least
  // certain member.
  const lowestConfidence = Math.min(...flagged.map((v) => v.confidence));
  const allAi = flagged.every((v) => v.source === "ai");

  const confidence =
    allAi && lowestConfidence > 0 ? (
      <ConfidenceBadge confidence={lowestConfidence} source="ai" />
    ) : null;

  return (
    <NoticeBanner
      mark={FadeMark}
      title={sole ? sole.title : "Transparency won't print as shown"}
      trailing={confidence}
      body={
        sole ? (
          sole.body
        ) : (
          <>
            ({count}) images have fades or see-through areas, which DTF can't print as they look.
            Update the files outlined in orange, or replace them with different files.
          </>
        )
      }
    />
  );
}
