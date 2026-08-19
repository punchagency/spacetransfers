interface FadeWarningProps {
  count: number;
}

export default function FadeWarning({ count }: FadeWarningProps) {
  if (count === 0) return null;

  return (
    <div className="absolute w-[860px] top-20 left-1/2 -translate-x-1/2 z-50 bg-[#FFF7ED] border border-[#F97316] rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
      <svg
        className="shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#F97316"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p
        style={{
          fontFamily: "Roboto",
          fontWeight: 400,
          fontSize: "14px",
          lineHeight: "20px",
          letterSpacing: "0px",
          color: "#C2410C",
        }}
      >
        <span style={{ fontWeight: 700 }}>Fade Detected</span>
        {" "}— ({count}) {count === 1 ? "image has" : "images have"} transparency fading. DTF Technology cannot print fades. Please remove transparency gradients or fading into transparency.
      </p>
    </div>
  );
}
