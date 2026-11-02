import toast from "react-hot-toast";
import { IssueChip } from "./IssueChip";
import { NoticeCard } from "./UnsupportedFilesWarning";

/** Below this, at print size, artwork is flagged. Display only — the detection
 *  logic lives in `computeEffectiveDpi` / `useDropHandler` and is unchanged. */
export const DPI_TARGET = 300;

const plural = (n: number, singular: string, many: string) =>
  n === 1 ? singular : many;

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
      ? " — select undetermined images and use DPI+ to be safe."
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
    ? `Aim for ${DPI_TARGET} DPI at print size. Select an undetermined image on the sheet and use DPI+ in its toolbar to be safe.`
    : `Aim for ${DPI_TARGET} DPI at print size. Select an image on the sheet and use DPI+ in its toolbar to raise it, or make the image smaller.`;

/**
 * Screen-reader summary for the chip.
 *
 * The breakdown lives in a hover/focus tooltip, which assistive tech does not
 * announce. Without this the chip read as a bare number.
 */
export const dpiStatusAriaLabel = (lowDpiCount: number, unknownDpiCount: number) =>
  `${dpiStatusTitle(lowDpiCount, unknownDpiCount)}: ${dpiClause(lowDpiCount, unknownDpiCount)}.`;

/**
 * Top-bar count of images below print resolution, in the amber their outline
 * carries on the sheet. One chip for both conditions — measurably low, and
 * unmeasurable — with the split in the hover card.
 */
export const DpiStatusChip = ({
  lowDpiCount = 0,
  unknownDpiCount = 0,
  onGoTo,
  compact,
}: {
  lowDpiCount?: number;
  unknownDpiCount?: number;
  /** Goes to the next flagged image on the sheet. */
  onGoTo?: () => void;
  compact?: boolean;
}) => (
  <IssueChip
    count={lowDpiCount + unknownDpiCount}
    label="dpi"
    tone="amber"
    heading="Resolution Check"
    lines={dpiStatusLines(lowDpiCount, unknownDpiCount)}
    guidance={`${dpiStatusGuidance(unknownDpiCount)} Each one is outlined in amber.`}
    ariaLabel={dpiStatusAriaLabel(lowDpiCount, unknownDpiCount)}
    onGoTo={onGoTo}
    compact={compact}
  />
);

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
