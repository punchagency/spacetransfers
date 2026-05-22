import { CANVAS } from "../../../../config/artboard.config";

interface CanvasMarginsProps {
  showMargins: boolean;
  marginSize: number;
  // Total sheet height in inches (un-zoomed). Used to match the left ruler's extent.
  heightIn: number;
}

export default function CanvasMargins({ showMargins, marginSize, heightIn }: CanvasMarginsProps) {
  if (!showMargins) return null;

  const ppi = CANVAS.PIXELS_PER_INCH;
  // All positions are in un-zoomed CSS pixels inside the scaled canvas div.
  // The canvas transform: scale(zoom) scales these to match the ruler ticks.
  const marginPx = marginSize * ppi;
  const innerWidthPx = (CANVAS.SHEET_WIDTH_IN - 2 * marginSize) * ppi;
  // Height must cover the full sheet in un-zoomed ppi units so the border lines
  // visually reach the same bottom as the left ruler.
  const innerHeightPx = Math.max(0, heightIn - marginSize) * ppi;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 15 }}>
      <div
        className="absolute border-t-2 border-l-2 border-r-2 border-dashed border-red-500"
        style={{
          top: `${marginPx}px`,
          left: `${marginPx}px`,
          width: `${innerWidthPx}px`,
          height: `${innerHeightPx}px`,
        }}
      />
      <div
        className="absolute text-red-500 text-xs font-medium"
        style={{
          top: `${marginPx}px`,
          left: `${marginPx}px`,
          paddingTop: "4px",
          paddingLeft: "4px",
        }}
      >
        Safe Print Area ({marginSize}" margin)
      </div>
    </div>
  );
}
