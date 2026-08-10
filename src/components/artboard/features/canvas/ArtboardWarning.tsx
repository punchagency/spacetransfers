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

const WARN_ICON_DPI = (
  <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EFB106" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <div className="absolute w-[860px] top-10 left-1/2 -translate-x-1/2 z-50 bg-[#FFF7ED] border border-[#F97316] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
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
      <div className="absolute w-[860px] top-10 left-1/2 -translate-x-1/2 z-50 bg-[#FFF7ED] border border-[#F97316] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
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

  // DPI only (low and/or unknown) — amber banner
  const title = lowDpiCount > 0 && unknownDpiCount > 0
    ? "DPI Issues Detected"
    : unknownDpiCount > 0 && lowDpiCount === 0
      ? "Unknown DPI Detected"
      : "Low DPI";

  return (
    <div className="absolute w-[860px] top-10 left-1/2 -translate-x-1/2 z-50 bg-[#FFFBEB] border border-[#EFB106] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
      {WARN_ICON_DPI}
      <p style={{ fontFamily: "Roboto", fontWeight: 400, fontSize: "14px", lineHeight: "20px", letterSpacing: "0px", color: "#EFB106" }}>
        <span style={{ fontWeight: 700 }}>{title}</span>
        {" "}— {dpiClause(lowDpiCount, unknownDpiCount)}. For optimal DTF printing quality, images should be at least 300 DPI at print size
        {unknownDpiCount > 0 ? " — verify undetermined images and enhance them to be safe." : "."}
      </p>
    </div>
  );
}
