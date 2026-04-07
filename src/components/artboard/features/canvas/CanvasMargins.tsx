import { CANVAS } from "../../../../config/artboard.config";

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

  const offset = 0; // Relative to scaled container
  const ppi = CANVAS.PIXELS_PER_INCH;
  const marginTop = `${offset + marginSize * ppi}px`;
  const marginLeft = `${offset + marginSize * ppi}px`;
  const marginRight = `${offset + marginSize * ppi}px`;

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
