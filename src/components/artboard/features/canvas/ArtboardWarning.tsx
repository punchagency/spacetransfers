interface ArtboardWarningProps {
  lowDpiCount: number;
  unknownDpiCount?: number;
  fadeCount: number;
  /**
   * The fade verdicts behind `fadeCount`, so the banner can say *why* rather
   * than only how many. When a single image is flagged its own explanation is
   * shown, which is far more actionable than the generic sentence — "a
   * sustained gradient into transparency was found" tells someone what to look
   * for, "transparency fading" does not.
   */
  fadeVerdicts?: Array<{ confidence: number; reason: string; source: "ai" | "heuristic" }>;
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
      className="ml-1 shrink-0 rounded-full border border-[#F97316]/40 bg-white/70 px-1.5 py-px text-[11px] font-semibold tabular-nums"
      title="How confident the AI fade check is in this result"
    >
      {Math.round(confidence * 100)}% confident
    </span>
  );
}

// Same stroke colour, size and stroke-width as the amber toast notices'
// WarningIcon (UnsupportedFilesWarning.tsx / LargeImageWarning.tsx) — kept in
// sync by eye rather than by import, since this icon renders inline in a
// full-width banner rather than through the toast's shared shell.
const WARN_ICON_DPI = (
  <svg className="mt-px shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const WARN_ICON_FADE = (
  <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

function plural(n: number, singular: string, plural: string) {
  return n === 1 ? singular : plural;
}

// Builds the DPI portion of the banner text — combines the low-DPI and
// unknown-DPI counts (each only included when > 0) into one clause so the
// two conditions never need their own separate banner.
function dpiClause(lowDpiCount: number, unknownDpiCount: number) {
  const parts: string[] = [];
  if (lowDpiCount > 0) {
    parts.push(`(${lowDpiCount}) ${plural(lowDpiCount, "image has", "images have")} a resolution below 300 DPI`);
  }
  if (unknownDpiCount > 0) {
    parts.push(`(${unknownDpiCount}) ${plural(unknownDpiCount, "image has", "images have")} an undetermined resolution`);
  }
  return parts.join(" and ");
}

export default function ArtboardWarning({
  lowDpiCount,
  unknownDpiCount = 0,
  fadeCount,
  fadeVerdicts = [],
}: ArtboardWarningProps) {
  const hasDpi = lowDpiCount > 0 || unknownDpiCount > 0;
  const hasFade = fadeCount > 0;

  if (!hasDpi && !hasFade) return null;

  // The specific explanation is only unambiguous for a single flagged image.
  // With several, each may have been flagged for a different reason, and
  // showing one image's would misattribute it to the rest.
  const soleVerdict = fadeCount === 1 && fadeVerdicts.length === 1 ? fadeVerdicts[0] : null;
  // Weakest link: the banner should not claim more certainty than its least
  // certain member.
  const lowestConfidence = fadeVerdicts.length
    ? Math.min(...fadeVerdicts.map((v) => v.confidence))
    : 0;
  const allAi = fadeVerdicts.length > 0 && fadeVerdicts.every((v) => v.source === "ai");

  // Both issues — merge into single orange banner at the DPI position (top-10)
  if (hasDpi && hasFade) {
    return (
      <div className="pointer-events-auto w-full bg-[#FFF7ED] border border-[#F97316] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
        {WARN_ICON_FADE}
        <p style={{ fontFamily: "Roboto", fontWeight: 400, fontSize: "14px", lineHeight: "20px", letterSpacing: "0px", color: "#C2410C" }}>
          <span style={{ fontWeight: 700 }}>Print Issues Detected</span>
          {" "}— ({fadeCount}) {plural(fadeCount, "image has", "images have")} transparency fading and {dpiClause(lowDpiCount, unknownDpiCount)}. DTF Technology cannot print fades. Ensure all images are at least 300 DPI at print size, and verify any with an undetermined resolution.
        </p>
      </div>
    );
  }

  // Fade only — orange banner
  if (hasFade) {
    return (
      <div className="pointer-events-auto w-full bg-[#FFF7ED] border border-[#F97316] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
        {WARN_ICON_FADE}
        <p style={{ fontFamily: "Roboto", fontWeight: 400, fontSize: "14px", lineHeight: "20px", letterSpacing: "0px", color: "#C2410C" }}>
          <span style={{ fontWeight: 700 }}>Fade Detected</span>
          {" "}— ({fadeCount}) {plural(fadeCount, "image has", "images have")} transparency fading.
          {/* The AI's own explanation when exactly one image is flagged; it
              names the evidence, which the generic sentence cannot. */}
          {soleVerdict?.reason ? ` ${soleVerdict.reason}` : ""} DTF Technology cannot print fades. Please remove transparency gradients or fading into transparency.
        </p>
        {allAi && lowestConfidence > 0 && (
          <ConfidenceBadge confidence={lowestConfidence} source="ai" />
        )}
      </div>
    );
  }

  // DPI only (low and/or unknown).
  //
  // Same card design as the toast notices — NoticeCard in
  // UnsupportedFilesWarning.tsx: #F59E0B border, #FFFBEB fill, rounded-xl,
  // bold #92400E title over a lighter #B45309 body, same icon. Left as its
  // own full-width docked banner rather than converted into a toast: this
  // stays visible for as long as any placed item is genuinely under 300 DPI
  // (it re-derives from `items` every render) and has no dismiss button — a
  // one-shot toast would auto-hide after ~7s even if the low-DPI artwork is
  // still on the sheet, and reproducing "stays until fixed" would need new
  // re-trigger wiring wherever items change. Position, visibility condition
  // and copy are otherwise unchanged.
  const title = lowDpiCount > 0 && unknownDpiCount > 0
    ? "DPI Issues Detected"
    : unknownDpiCount > 0 && lowDpiCount === 0
      ? "Unknown DPI Detected"
      : "Low DPI";

  return (
    <div className="pointer-events-auto w-full rounded-xl border border-[#F59E0B] bg-[#FFFBEB] px-3.5 py-2.5 shadow-lg">
      <div className="flex items-start gap-2.5">
        {WARN_ICON_DPI}
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-bold leading-[18px] text-[#92400E]">{title}</p>
          <p className="mt-0.5 text-[12.5px] leading-[17px] text-[#B45309]">
            {dpiClause(lowDpiCount, unknownDpiCount)}. For optimal DTF printing quality, images should be at least 300 DPI at print size
            {unknownDpiCount > 0 ? " — verify undetermined images and enhance them to be safe." : "."}
          </p>
        </div>
      </div>
    </div>
  );
}
