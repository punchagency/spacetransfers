interface ArtboardWarningProps {
  lowDpiCount: number;
  fadeCount: number;
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

export default function ArtboardWarning({ lowDpiCount, fadeCount }: ArtboardWarningProps) {
  const hasDpi = lowDpiCount > 0;
  const hasFade = fadeCount > 0;

  if (!hasDpi && !hasFade) return null;

  // Both issues — merge into single orange banner at the DPI position (top-10)
  if (hasDpi && hasFade) {
    return (
      <div className="absolute w-[860px] top-10 left-1/2 -translate-x-1/2 z-50 bg-[#FFF7ED] border border-[#F97316] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
        {WARN_ICON_FADE}
        <p style={{ fontFamily: "Roboto", fontWeight: 400, fontSize: "14px", lineHeight: "20px", letterSpacing: "0px", color: "#C2410C" }}>
          <span style={{ fontWeight: 700 }}>Print Issues Detected</span>
          {" "}— ({fadeCount}) {plural(fadeCount, "image has", "images have")} transparency fading and ({lowDpiCount}) {plural(lowDpiCount, "image has", "images have")} low DPI. DTF Technology cannot print fades. Ensure all images are at least 300 DPI at print size.
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
          {" "}— ({fadeCount}) {plural(fadeCount, "image has", "images have")} transparency fading. DTF Technology cannot print fades. Please remove transparency gradients or fading into transparency.
        </p>
      </div>
    );
  }

  // DPI only — amber banner
  return (
    <div className="absolute w-[860px] top-10 left-1/2 -translate-x-1/2 z-50 bg-[#FFFBEB] border border-[#EFB106] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
      {WARN_ICON_DPI}
      <p style={{ fontFamily: "Roboto", fontWeight: 400, fontSize: "14px", lineHeight: "20px", letterSpacing: "0px", color: "#EFB106" }}>
        <span style={{ fontWeight: 700 }}>Low DPI</span>
        {" "}— ({lowDpiCount}) {plural(lowDpiCount, "image has", "images have")} a resolution below 300 DPI. For optimal DTF printing quality, images should be at least 300 DPI at print size.
      </p>
    </div>
  );
}
