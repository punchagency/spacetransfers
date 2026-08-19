import toast from "react-hot-toast";
import { NoticeCard, WarningIcon } from "./UnsupportedFilesWarning";

/**
 * Shared definition for the resolution (DPI) status system.
 *
 * The DPI state is surfaced in three places at once — a compact chip in the
 * top bar, a hover tooltip off that chip, and a toast when a drop lands — and
 * all three describe the same counts. This is the one place that defines the
 * wording, so the three can't drift into disagreeing about what the same
 * numbers mean.
 *
 * Visually, the whole system renders through the same amber chrome as every
 * other advisory in the app (`WarningIcon` / `NoticeCard`, both from
 * `UnsupportedFilesWarning`) rather than keeping its own palette.
 *
 * ## Why a toast rather than a card docked over the canvas
 *
 * The two halves of "low DPI" want opposite lifetimes, and trying to serve
 * both with one surface is what made the docked card awkward. *That a drop
 * contained low-DPI artwork* is news, tied to that drop, and belongs in the
 * same transient notice as "3 files skipped" and "large image detected" — it
 * ages out on the same timer they do, and it stacks with them instead of
 * occupying its own private slot over the artboard. *That the sheet currently
 * holds low-DPI artwork* is a standing condition, and that is exactly what the
 * top-bar chip reports, for as long as it holds. Splitting them this way also
 * means the notice no longer has to justify a dismiss button that couldn't
 * make the artwork's resolution stop being low.
 */

/** Below this, at print size, artwork is flagged. Display only — the detection
 *  logic lives in `computeEffectiveDpi` / `useDropHandler` and is unchanged. */
export const DPI_TARGET = 300;

const plural = (n: number, singular: string, many: string) =>
  n === 1 ? singular : many;

/**
 * Title for a given pair of counts.
 *
 * Kept as one function because the header and the banner previously disagreed:
 * the header hardcoded "Low DPI Detected" per-indicator (so both could appear
 * at once, saying two different things side by side), while the banner derived
 * a combined title. The banner's derivation was the right one and is now the
 * only one.
 */
export const dpiStatusTitle = (lowDpiCount: number, unknownDpiCount: number) => {
  if (lowDpiCount > 0 && unknownDpiCount > 0) return "DPI Issues Detected";
  if (unknownDpiCount > 0) return "Unknown DPI Detected";
  return "Low DPI";
};

/**
 * The DPI portion of the banner sentence — each count included only when
 * non-zero, so the two conditions never need separate banners.
 *
 * Wording is carried over verbatim from the previous implementation.
 */
export const dpiClause = (lowDpiCount: number, unknownDpiCount: number) => {
  const parts: string[] = [];
  if (lowDpiCount > 0) {
    parts.push(
      `(${lowDpiCount}) ${plural(lowDpiCount, "image has", "images have")} a resolution below ${DPI_TARGET} DPI`,
    );
  }
  if (unknownDpiCount > 0) {
    parts.push(
      `(${unknownDpiCount}) ${plural(unknownDpiCount, "image has", "images have")} an undetermined resolution`,
    );
  }
  return parts.join(" and ");
};

/** Full card body: the clause plus the standing guidance. */
export const dpiStatusBody = (lowDpiCount: number, unknownDpiCount: number) =>
  `${dpiClause(lowDpiCount, unknownDpiCount)}. For optimal DTF printing quality, images should be at least ${DPI_TARGET} DPI at print size${
    unknownDpiCount > 0
      ? " — verify undetermined images and enhance them to be safe."
      : "."
  }`;

/**
 * Tooltip breakdown, one line per condition.
 *
 * The chip deliberately shows a single combined count — two adjacent badges was
 * the clutter the top-bar redesign removed — so the split has to be recoverable
 * somewhere, and a two-line list is faster to read than the card's prose.
 */
export const dpiStatusLines = (lowDpiCount: number, unknownDpiCount: number) => {
  const lines: string[] = [];
  if (lowDpiCount > 0) {
    lines.push(`${lowDpiCount} ${plural(lowDpiCount, "image is", "images are")} below ${DPI_TARGET} DPI`);
  }
  if (unknownDpiCount > 0) {
    lines.push(`${unknownDpiCount} ${plural(unknownDpiCount, "image has", "images have")} an undetermined resolution`);
  }
  return lines;
};

/** Standing guidance under the tooltip's breakdown. */
export const dpiStatusGuidance = (unknownDpiCount: number) =>
  unknownDpiCount > 0
    ? `Aim for ${DPI_TARGET} DPI at print size. Open an undetermined image on the artboard and use Enhance to be safe.`
    : `Aim for ${DPI_TARGET} DPI at print size. Select an image on the artboard and use Enhance to scale it up.`;

/**
 * Screen-reader summary for the chip.
 *
 * The breakdown lives in a hover/focus tooltip, which assistive tech does not
 * announce. Without this the chip read as a bare number.
 */
export const dpiStatusAriaLabel = (lowDpiCount: number, unknownDpiCount: number) =>
  `${dpiStatusTitle(lowDpiCount, unknownDpiCount)}: ${dpiClause(lowDpiCount, unknownDpiCount)}.`;

/**
 * Compact resolution-status chip for the top bar.
 *
 * Replaces two separate indicators — a solid disc with a floating red count
 * bubble, one for low DPI and one for unknown DPI, which could both be on
 * screen at once. Now one pill in the same amber the rest of the advisory
 * system uses (`#FFFBEB` fill, `#F59E0B` border, the shared `WarningIcon`), so
 * a customer who has already learned what that colour means from a dropped
 * file elsewhere in the app recognises it here without re-learning it.
 *
 * The low/unknown split lives in the hover tooltip rather than as two adjacent
 * badges — a single number is what keeps the top bar quiet.
 *
 * Renders nothing when there is nothing to report, so the top bar is unchanged
 * for the common case.
 */
export const DpiStatusChip = ({
  lowDpiCount = 0,
  unknownDpiCount = 0,
  onToggleHighlight,
  isHighlighting = false,
}: {
  lowDpiCount?: number;
  unknownDpiCount?: number;
  /**
   * Reveals the flagged artwork on the sheet. Optional: without it the chip
   * stays the passive readout it was, rather than rendering a button that
   * does nothing.
   */
  onToggleHighlight?: () => void;
  isHighlighting?: boolean;
}) => {
  const total = lowDpiCount + unknownDpiCount;
  if (total < 1) return null;

  const lines = dpiStatusLines(lowDpiCount, unknownDpiCount);
  const interactive = Boolean(onToggleHighlight);

  const label = interactive
    ? `${dpiStatusAriaLabel(lowDpiCount, unknownDpiCount)} ${
        isHighlighting ? "Hide" : "Show"
      } them on the sheet.`
    : dpiStatusAriaLabel(lowDpiCount, unknownDpiCount);

  return (
    // `data-dpi-chip` marks the chip's whole subtree for the outside-click
    // check that dismisses the highlight — without it, the pointerdown that
    // opens the highlight is itself an "outside click" and closes it again.
    <span className="relative inline-flex group" data-dpi-chip>
      <button
        type="button"
        // A real button, not a `role="status"` span. The chip does something
        // now, and the counts are already announced when they arise (the drop
        // raises a polite toast) — so making this focusable, pressable and
        // keyboard-operable is worth more than a second live region that
        // re-reads the same number.
        onClick={onToggleHighlight}
        aria-pressed={interactive ? isHighlighting : undefined}
        aria-label={label}
        disabled={!interactive}
        /*
         * Hover in/out is CSS `:hover` rather than React `onMouseEnter` /
         * `onMouseLeave` state. Two reasons, both load-bearing: the browser
         * restores the resting style on its own when the pointer leaves —
         * including the cases a JS handler misses, like the element unmounting
         * under the cursor or a tab losing focus mid-hover — and it costs no
         * re-render, which matters for a control that lives in the top bar of
         * a board that can be re-rendering hundreds of placements.
         *
         * It also makes "hovering triggers nothing" structural: there is no
         * handler that could grow a side effect later.
         */
        className={[
          "inline-flex items-center gap-1.5 rounded-full border py-[3px] pl-1.5 pr-2",
          // `transform` and `box-shadow` are compositor properties; the colour
          // pair costs a cheap repaint on a 20px element.
          "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out",
          "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          interactive ? "cursor-pointer" : "cursor-default",
          // The lift applies in *both* the idle and pressed states. Dropping it
          // while pressed — as this did — made the chip go inert exactly when a
          // customer was most likely to reach for it again to switch off.
          interactive
            ? "group-hover:-translate-y-px group-hover:shadow-[0_2px_8px_rgba(217,119,6,0.25)] group-focus-within:-translate-y-px group-focus-within:shadow-[0_2px_8px_rgba(217,119,6,0.25)]"
            : "",
          isHighlighting
            ? // Pressed reads as "this filter is on", using the deepest step of
              // the same amber ramp rather than a new accent colour. Hover goes
              // one step deeper again, so there is still somewhere to move.
              "border-[#F59E0B] bg-[#FDE68A] ring-2 ring-[#F59E0B]/30 group-hover:bg-[#FCD34D] group-focus-within:bg-[#FCD34D]"
            : "border-[#F59E0B]/50 bg-[#FFFBEB] group-hover:border-[#F59E0B] group-hover:bg-[#FEF3C7] group-focus-within:border-[#F59E0B] group-focus-within:bg-[#FEF3C7]",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <WarningIcon size={13} />
        <span className="text-[11px] font-bold leading-none tabular-nums text-[#92400E]">
          {total > 99 ? "99+" : total}
        </span>
        <span className="text-[9px] font-semibold uppercase leading-none tracking-widest text-[#B45309]">
          dpi
        </span>
      </button>

      {/* Same card family as the notice toast — text-on-amber, hairline
          #F59E0B border — so the chip, its tooltip and the notice all read as
          one system rather than three separately-tuned palettes. */}
      <span className="pointer-events-none absolute left-1/2 top-full z-[9999] mt-2 hidden w-[272px] -translate-x-1/2 flex-col rounded-xl border border-[#F59E0B] bg-[#FFFBEB] px-3.5 py-3 text-left shadow-lg group-hover:flex group-focus-within:flex">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#92400E]">
          Resolution Check
        </span>

        <span className="mt-2 flex flex-col gap-1.5">
          {lines.map((line) => (
            <span key={line} className="flex items-start gap-2">
              <span className="mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#F59E0B]" />
              <span className="text-[12px] leading-[16px] text-[#92400E]">{line}</span>
            </span>
          ))}
        </span>

        <span className="mt-2.5 border-t border-[#F59E0B]/30 pt-2 text-[11px] leading-[1.5] text-[#B45309]">
          {dpiStatusGuidance(unknownDpiCount)}
        </span>

        {interactive && (
          <span className="mt-2 border-t border-[#F59E0B]/30 pt-2 text-[11px] font-semibold leading-[1.5] text-[#92400E]">
            {isHighlighting
              ? "Click to clear the highlight."
              : `Click to highlight ${total === 1 ? "it" : "them"} on the sheet.`}
          </span>
        )}
      </span>
    </span>
  );
};

/**
 * Matches the "files skipped" and "large image" notices, so every advisory
 * raised by one drop ages out together rather than leaving a straggler behind.
 */
const WARNING_DURATION_MS = 7000;

/**
 * Shows the Low DPI notice.
 *
 * Renders through `NoticeCard` — the same shell, width and toast queue the
 * large-image notice uses — so when a drop raises both, they stack as two
 * notices rather than being merged into one or fighting for the same corner of
 * the artboard. react-hot-toast puts the newest at the top and slides the
 * older one down; each then expires on its own timer.
 *
 * A fixed `id` collapses repeats the way the other batch notices do: a
 * customer dropping three folders in quick succession should see the count
 * replaced, not three cards stacked saying nearly the same thing.
 */
export const showLowDpiWarning = (lowDpiCount: number, unknownDpiCount = 0) => {
  if (lowDpiCount + unknownDpiCount < 1) return;

  const title = dpiStatusTitle(lowDpiCount, unknownDpiCount);
  const body = dpiStatusBody(lowDpiCount, unknownDpiCount);

  toast.custom((t) => <NoticeCard t={t} title={title} body={body} />, {
    duration: WARNING_DURATION_MS,
    id: "low-dpi-warning",
  });
};
