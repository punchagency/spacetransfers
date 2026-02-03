interface DpiWarningProps {
  count: number;
}

export default function DpiWarning({ count }: DpiWarningProps) {
  if (count === 0) return null;

  return (
    <div className="absolute w-[720px] text-center top-10 left-1/2 -translate-x-1/2 z-50 bg-[#FFFBEB] border border-[#EFB106] rounded-lg px-4 py-2 shadow-lg">
      <p
        style={{
          fontFamily: "Roboto",
          fontWeight: 400,
          fontSize: "14px",
          lineHeight: "20px",
          letterSpacing: "0px",
          color: "#EFB106",
        }}
      >
        {count} image{count > 1 ? "s have" : " has"} resolution below 300 DPI. For
        optimal DTF printing quality, images should be at least 300 DPI at print size.
      </p>
    </div>
  );
}
