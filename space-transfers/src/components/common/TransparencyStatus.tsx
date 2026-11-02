import { IssueChip } from "./IssueChip";

const images = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The chip's word for what it is counting: the one kind present, or both. */
export const transparencyChipLabel = (fadeCount: number, seeThroughCount: number) =>
  fadeCount > 0 && seeThroughCount > 0 ? "transparency" : seeThroughCount > 0 ? "see-through" : "fade";

/** One line per kind of transparency DTF can't print as shown. */
export const transparencyStatusLines = (fadeCount: number, seeThroughCount: number) => {
  const lines: string[] = [];
  if (fadeCount > 0) lines.push(images(fadeCount, "image fades into transparency", "images fade into transparency"));
  if (seeThroughCount > 0) lines.push(images(seeThroughCount, "image has see-through areas", "images have see-through areas"));
  return lines;
};

export const TRANSPARENCY_GUIDANCE =
  "DTF prints ink or no ink, so fades and see-through areas won't print as they look. Update the file to make them solid, or replace it. Each one is outlined in orange.";

export const transparencyAriaLabel = (fadeCount: number, seeThroughCount: number) =>
  `Transparency that won't print as shown: ${transparencyStatusLines(fadeCount, seeThroughCount).join(" and ")}.`;

/**
 * Top-bar count of images whose transparency DTF can't print as shown, in the
 * orange their outline carries on the sheet.
 */
export const TransparencyChip = ({
  fadeCount = 0,
  seeThroughCount = 0,
  onGoTo,
  compact,
}: {
  fadeCount?: number;
  seeThroughCount?: number;
  onGoTo?: () => void;
  compact?: boolean;
}) => (
  <IssueChip
    count={fadeCount + seeThroughCount}
    label={transparencyChipLabel(fadeCount, seeThroughCount)}
    tone="orange"
    heading="Transparency Check"
    lines={transparencyStatusLines(fadeCount, seeThroughCount)}
    guidance={TRANSPARENCY_GUIDANCE}
    ariaLabel={transparencyAriaLabel(fadeCount, seeThroughCount)}
    onGoTo={onGoTo}
    compact={compact}
  />
);
