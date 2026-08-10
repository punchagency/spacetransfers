import toast from "react-hot-toast";
import { MdClose } from "react-icons/md";

/**
 * Non-blocking notice for artwork larger than the sheet's printable area.
 *
 * This used to be `toast.error("Image width cannot exceed the printable area
 * …")`, which was wrong in both tone and substance. The upload had in fact
 * succeeded, so a red error stated a failure that had not happened — and it
 * gave no indication of what to do about it. Being oversized is a thing worth
 * knowing before printing, not a thing that went wrong.
 *
 * Amber rather than red is the whole point: red is reserved for states that
 * actually block progress (a corrupt file, a failed upload). Using it here
 * taught customers to distrust it.
 */

/** Mid-point of the requested 6–8s window. */
const WARNING_DURATION_MS = 7000;

const WarningIcon = () => (
  <svg
    className="mt-px shrink-0"
    width="20"
    height="20"
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
 * Body copy, worded for one image or several.
 *
 * Exported so its wording is testable without rendering a toast — the exact
 * reassurance ("added successfully") is the part that stops this reading as a
 * failure, and it should not be able to drift unnoticed.
 */
export const largeImageWarningText = (count: number) => {
  const isSingle = count <= 1;
  return {
    title: isSingle ? "Large Image Detected" : `${count} Large Images Detected`,
    body: isSingle
      ? "This image is larger than the recommended printable area for the selected gang sheet. It has been added successfully, but you may need to resize or reposition it to ensure it fits within the printable area before printing."
      : `These images are larger than the recommended printable area for the selected gang sheet. They have been added successfully, but you may need to resize or reposition them to ensure they fit within the printable area before printing.`,
  };
};

/**
 * Shows the notice.
 *
 * `count` aggregates a whole drop into one message. Files upload concurrently,
 * so a per-file toast would stack several overlapping copies of the same
 * advice — which is how a helpful notice becomes noise people dismiss without
 * reading.
 */
export const showLargeImageWarning = (count = 1) => {
  if (count < 1) return;
  const { title, body } = largeImageWarningText(count);

  toast.custom(
    (t) => (
      <div
        role="status"
        // `polite`, not `assertive`: this must not interrupt a screen-reader
        // user mid-sentence for something that did not block their work.
        aria-live="polite"
        className={`pointer-events-auto w-[420px] max-w-[92vw] rounded-xl border border-[#F59E0B] bg-[#FFFBEB] px-4 py-3 shadow-lg transition-all duration-200 ${
          t.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
        }`}
      >
        <div className="flex items-start gap-3">
          <WarningIcon />

          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold leading-5 text-[#92400E]">{title}</p>
            {/* Generous leading and a hard measure: this is three lines of
                explanation, and at tight line-height it reads as a wall of
                text people skip. */}
            <p className="mt-1 text-[13px] leading-[19px] text-[#B45309]">{body}</p>
          </div>

          <button
            onClick={() => toast.dismiss(t.id)}
            aria-label="Dismiss warning"
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#B45309] transition hover:bg-[#FDE68A] active:scale-95"
          >
            <MdClose className="h-4 w-4" />
          </button>
        </div>
      </div>
    ),
    { duration: WARNING_DURATION_MS, id: "large-image-warning" },
  );
};
