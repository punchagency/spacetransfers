interface CanvasMarginsProps {
  showMargins: boolean;
  showRulers: boolean;
  marginSize: number;
  zoom: number;
}

export default function CanvasMargins({
  showMargins,
  showRulers,
  marginSize,
  zoom,
}: CanvasMarginsProps) {
  if (!showMargins) return null;

  const offset = showRulers ? 20 : 20;
  const marginTop = `${offset + marginSize * 96}px`;
  const marginLeft = `${offset + marginSize * 96}px`;
  const marginRight = `${offset + marginSize * 96}px`;

  return (
    <div className="absolute inset-0 pointer-events-none z-15">
      {/* Combined Margins - Single div ensures perfectly connected corners */}
      <div
        className="absolute border-t-2 border-l-2 border-r-2 border-dashed border-red-500"
        style={{
          top: marginTop,
          left: marginLeft,
          right: marginRight,
          bottom: 0,
        }}
      />

      <div
        className="absolute text-red-500 text-xs font-medium"
        style={{
          top: marginTop,
          left: marginLeft,
          paddingTop: "4px",
          paddingLeft: "4px",
        }}
      >
        Safe Print Area ({marginSize}" margin)
      </div>
    </div>
  );
}
