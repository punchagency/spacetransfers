import { WarningIcon } from "./UnsupportedFilesWarning";

export type IssueTone = "amber" | "orange" | "red";

/** Class names are spelled out per tone so the build can see every one of them. */
const TONES: Record<IssueTone, { chip: string; count: string; label: string; card: string; heading: string; line: string; dot: string; rule: string; guidance: string }> = {
  amber: {
    chip: "border-[#F59E0B]/50 bg-[#FFFBEB] group-hover:border-[#F59E0B] group-hover:bg-[#FEF3C7] group-hover:shadow-[0_2px_8px_rgba(217,119,6,0.25)] group-focus-within:border-[#F59E0B] group-focus-within:bg-[#FEF3C7] group-focus-within:shadow-[0_2px_8px_rgba(217,119,6,0.25)]",
    count: "text-[#92400E]",
    label: "text-[#B45309]",
    card: "border-[#F59E0B] bg-[#FFFBEB]",
    heading: "text-[#92400E]",
    line: "text-[#92400E]",
    dot: "bg-[#F59E0B]",
    rule: "border-[#F59E0B]/30",
    guidance: "text-[#B45309]",
  },
  orange: {
    chip: "border-[#F97316]/50 bg-[#FFF7ED] group-hover:border-[#F97316] group-hover:bg-[#FFEDD5] group-hover:shadow-[0_2px_8px_rgba(234,88,12,0.25)] group-focus-within:border-[#F97316] group-focus-within:bg-[#FFEDD5] group-focus-within:shadow-[0_2px_8px_rgba(234,88,12,0.25)]",
    count: "text-[#9A3412]",
    label: "text-[#C2410C]",
    card: "border-[#F97316] bg-[#FFF7ED]",
    heading: "text-[#9A3412]",
    line: "text-[#9A3412]",
    dot: "bg-[#F97316]",
    rule: "border-[#F97316]/30",
    guidance: "text-[#C2410C]",
  },
  red: {
    chip: "border-[#DC2626]/50 bg-[#FEF2F2] group-hover:border-[#DC2626] group-hover:bg-[#FEE2E2] group-hover:shadow-[0_2px_8px_rgba(220,38,38,0.25)] group-focus-within:border-[#DC2626] group-focus-within:bg-[#FEE2E2] group-focus-within:shadow-[0_2px_8px_rgba(220,38,38,0.25)]",
    count: "text-[#991B1B]",
    label: "text-[#B91C1C]",
    card: "border-[#DC2626] bg-[#FEF2F2]",
    heading: "text-[#991B1B]",
    line: "text-[#991B1B]",
    dot: "bg-[#DC2626]",
    rule: "border-[#DC2626]/30",
    guidance: "text-[#B91C1C]",
  },
};

/**
 * A count of artwork that needs attention, in the top bar.
 *
 * The same pill for every kind of issue — resolution, transparency — told
 * apart by colour and label, each matching the outline its artwork carries on
 * the sheet. Hovering explains the issue; clicking goes to the next affected
 * image, so on a long sheet the number is also the way to find them.
 *
 * Renders nothing when the count is zero.
 */
export const IssueChip = ({
  count,
  label,
  tone,
  heading,
  lines,
  guidance,
  ariaLabel,
  onGoTo,
  compact = false,
}: {
  count: number;
  /** One or two words, shown in small capitals after the count. */
  label: string;
  tone: IssueTone;
  heading: string;
  lines: string[];
  guidance: string;
  /** What the count means, for a screen reader; the hover card is not announced. */
  ariaLabel: string;
  /** Goes to the next affected image. Without it the chip is a plain readout. */
  onGoTo?: () => void;
  /** Count and colour only, for a phone's header, where the sheet name needs the room. */
  compact?: boolean;
}) => {
  if (count < 1) return null;
  const t = TONES[tone];
  const interactive = Boolean(onGoTo);
  const action = count === 1 ? "Go to it on the sheet." : "Step through them on the sheet.";

  return (
    <span className="relative inline-flex group" data-issue-chip={label}>
      <button
        type="button"
        onClick={(e) => {
          onGoTo?.();
          // A touch leaves the button focused, which would hold the hover card
          // open over the image the tap just went to.
          if (!window.matchMedia?.("(hover: hover)").matches) e.currentTarget.blur();
        }}
        aria-label={interactive ? `${ariaLabel} ${action}` : ariaLabel}
        disabled={!interactive}
        className={[
          "inline-flex items-center gap-1.5 rounded-full border py-[3px] pl-1.5 pr-2",
          "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out",
          "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          interactive ? "cursor-pointer group-hover:-translate-y-px group-focus-within:-translate-y-px active:translate-y-0" : "cursor-default",
          t.chip,
        ].join(" ")}
      >
        <WarningIcon size={13} />
        <span className={`text-[11px] font-bold leading-none tabular-nums ${t.count}`}>{count > 99 ? "99+" : count}</span>
        {!compact && (
          <span className={`text-[9px] font-semibold uppercase leading-none tracking-widest ${t.label}`}>{label}</span>
        )}
      </button>

      <span
        className={`pointer-events-none absolute left-1/2 top-full z-[9999] mt-2 hidden w-[272px] -translate-x-1/2 flex-col rounded-xl border px-3.5 py-3 text-left shadow-lg group-hover:flex group-focus-within:flex ${t.card}`}
      >
        <span className={`text-[10px] font-bold uppercase tracking-wider ${t.heading}`}>{heading}</span>
        <span className="mt-2 flex flex-col gap-1.5">
          {lines.map((line) => (
            <span key={line} className="flex items-start gap-2">
              <span className={`mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full ${t.dot}`} />
              <span className={`text-[12px] leading-[16px] ${t.line}`}>{line}</span>
            </span>
          ))}
        </span>
        <span className={`mt-2.5 border-t pt-2 text-[11px] leading-[1.5] ${t.rule} ${t.guidance}`}>{guidance}</span>
        {interactive && (
          <span className={`mt-2 border-t pt-2 text-[11px] font-semibold leading-[1.5] ${t.rule} ${t.heading}`}>
            Click to {count === 1 ? "go to it" : "step through them"} on the sheet.
          </span>
        )}
      </span>
    </span>
  );
};
