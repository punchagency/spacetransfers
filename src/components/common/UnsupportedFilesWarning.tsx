import toast from "react-hot-toast";
import { MdClose } from "react-icons/md";

/**
 * Notice for files skipped because the artboard cannot read their format.
 *
 * Replaces `toast.error("N unsupported files skipped. Accepted: …")`, which was
 * wrong in the same two ways the large-image notice used to be. Red is reserved
 * for states that actually blocked the customer's work; skipping an unreadable
 * file while adding every valid one alongside it is information, not a failure,
 * and dressing it as an error is what teaches people to ignore red. And a
 * single run-on sentence buried the two things they need — how many were
 * dropped, and what to re-export as — in the middle of the line.
 *
 * Deliberately more compact than `LargeImageWarning`: that notice has to
 * explain a consequence and a remedy, this one only has to name a count and
 * four formats. Same palette, radius and type scale so they read as one family.
 */

/** Matches the large-image notice, so two warnings from one drop age out together. */
const WARNING_DURATION_MS = 7000;

const WarningIcon = () => (
  <svg
    className="mt-px shrink-0"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#D97706"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/**
 * Human-facing format names, derived from the MIME types the drop handler
 * actually accepts rather than written out again here.
 *
 * The old copy hardcoded "PNG, JPG, SVG, PDF" in the toast while the accepted
 * list lived in `useDropHandler`. Two sources for one fact drift: the list a
 * customer is told to re-export to has to be the list that will actually be
 * taken, or the advice sends them round the loop a second time.
 */
const MIME_LABELS: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/svg+xml": "SVG",
  "application/pdf": "PDF",
};

export const formatLabels = (mimeTypes: readonly string[]): string[] => [
  ...new Set(
    mimeTypes.map((m) => MIME_LABELS[m] ?? m.split("/")[1]?.toUpperCase() ?? m),
  ),
];

/**
 * Title and body, worded for one file or several.
 *
 * Exported so the wording is testable without rendering a toast — the count
 * and the format list are the load-bearing parts and should not drift silently.
 */
export const unsupportedFilesText = (
  count: number,
  mimeTypes: readonly string[],
) => ({
  title: `${count} file${count === 1 ? "" : "s"} skipped`,
  body: `Unsupported file format. Supported: ${formatLabels(mimeTypes).join(", ")}.`,
});

/**
 * The shared card shell — icon, colours, radius, spacing, animation, dismiss
 * button. Both notices below render through this, so "the exact same UI
 * component and visual design" is structural (one JSX block), not a matter of
 * two copies that have to be kept in sync by hand.
 *
 * Exported so other toast-based notices (large-image, low-DPI) can render
 * through the identical shell instead of keeping their own near-duplicate
 * markup that has to be hand-matched pixel-for-pixel every time this one
 * changes.
 */
export const NoticeCard = ({
  t,
  title,
  body,
  truncateTitle = false,
}: {
  t: { visible: boolean; id: string };
  title: string;
  body: string;
  /** Set for content that can be arbitrarily long, e.g. a filename. */
  truncateTitle?: boolean;
}) => (
  <div
    role="status"
    // `polite`: nothing here blocked the customer, so it must not interrupt
    // a screen reader mid-sentence.
    aria-live="polite"
    className={`pointer-events-auto w-[380px] mt-16 max-w-[92vw] rounded-xl border border-[#F59E0B] bg-[#FFFBEB] px-3.5 py-2.5 shadow-lg transition-all duration-200 ${
      t.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
    }`}
  >
    <div className="flex items-start gap-2.5">
      <WarningIcon />

      <div className="min-w-0 flex-1">
        {/* #92400E on #FFFBEB is ~8.9:1, and #B45309 ~5.6:1 — both clear
            WCAG AA at these sizes, which plain amber-on-white would not. */}
        <p
          className={`text-[18px] font-bold leading-[18px] text-[#92400E] ${
            truncateTitle ? "truncate" : ""
          }`}
          title={truncateTitle ? title : undefined}
        >
          {title}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-[17px] text-[#B45309]">
          {body}
        </p>
      </div>

      <button
        onClick={() => toast.dismiss(t.id)}
        aria-label="Dismiss notice"
        className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#B45309] transition hover:bg-[#FDE68A] active:scale-95"
      >
        <MdClose className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

/**
 * Shows the notice.
 *
 * A fixed `id` collapses repeats: a drop is filtered in one pass, but a
 * customer who drags three unsupported batches in quick succession should see
 * the message replaced rather than stacked.
 */
export const showUnsupportedFilesWarning = (
  count: number,
  mimeTypes: readonly string[],
) => {
  if (count < 1) return;
  const { title, body } = unsupportedFilesText(count, mimeTypes);

  toast.custom(
    (t) => <NoticeCard t={t} title={title} body={body} />,
    { duration: WARNING_DURATION_MS, id: "unsupported-files-warning" },
  );
};

/**
 * Every message `validateImageFile()` returns is shaped `"<filename>" <reason>.`
 * — see `fileValidation.ts` (the empty-file, unreadable, wrong-content-type and
 * PDF-mismatch cases all follow it. Splitting on the leading quoted segment
 * lets the filename — which can be arbitrarily long, unlike the fixed reason
 * text — become its own truncatable title, while the reason (the part that
 * tells the customer what to actually do) always renders in full underneath.
 * This only reshapes how the existing string is *displayed*; the wording
 * itself still comes verbatim from validation, for every branch it covers.
 */
export const splitFileMessage = (message: string): { fileName: string; reason: string } => {
  const match = message.match(/^[“"]([^”"]*)[”"]\s*(.*)$/s);
  if (!match) return { fileName: message, reason: "" };
  return { fileName: match[1], reason: match[2] };
};

/**
 * Shows a `validateImageFile()` rejection — e.g. a WEBP, a mislabelled file,
 * or a damaged upload — in the same card as the batch notice above.
 *
 * No fixed toast id: unlike the batch notice (one call for a whole drop),
 * this fires once per file inside the upload pool, and several different
 * bad files can genuinely fail at once. Collapsing them under one id would
 * silently hide every file but the last, which is a behaviour change this
 * redesign is not meant to make — each invalid file still gets its own
 * notice, exactly as before.
 */
export const showUnsupportedFileWarning = (message: string) => {
  if (!message) return;
  const { fileName, reason } = splitFileMessage(message);

  toast.custom(
    (t) => (
      <NoticeCard
        t={t}
        title={fileName ? `“${fileName}”` : "Unsupported file"}
        body={reason || message}
        truncateTitle
      />
    ),
    // 6000ms — the exact duration the plain toast this replaces already used.
    { duration: 6000 },
  );
};
