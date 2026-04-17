import RulerSegment from "../rulers/RulerSegment";
import { CANVAS } from "../../../../config/artboard.config";

interface CanvasRulersProps {
  showRulers: boolean;
  zoom: number;
  sheetHeightPx: number;
  scrollTopPx: number;
  viewportHeightPx: number;
}

export default function CanvasRulers({
  showRulers,
  zoom,
  sheetHeightPx,
  scrollTopPx,
  viewportHeightPx,
}: CanvasRulersProps) {
  if (!showRulers) return null;

  // Top ruler should represent a fixed 23.5-inch scale,
  // but it must visually fit when browser zoom is 100%.
  const topRulerLengthInches = 23.5;
  const offset = CANVAS.RULER_OFFSET_PX;
  const ppi = CANVAS.PIXELS_PER_INCH;

  const topFull = Math.floor(topRulerLengthInches);
  const topRemainder = topRulerLengthInches - topFull;
  const totalHeightIn = Math.max(0, sheetHeightPx / (ppi * zoom || 1));
  const leftFull = Math.floor(totalHeightIn);
  const leftRemainder = totalHeightIn - leftFull;

  // Ruler uses the same global zoom as the sheet; no extra local scaling.
  const fitScale = 1;

  return (
    <>
      {/* Top Ruler */}
      <div 
        className="absolute top-0 z-50 bg-transparent pointer-events-none overflow-hidden"
        style={{ left: `${offset}px`, width: `calc(100% - ${offset}px)`, height: `${offset}px` }}
      >
        <div
          className="h-full flex"
          style={{
            width: `${topRulerLengthInches * ppi * zoom}px`,
            transform: `scaleX(${fitScale})`,
            transformOrigin: "left center",
          }}
        >
          {Array.from({ length: topFull }).map((_, i) => (
            <div key={i} style={{ width: `${ppi * zoom}px`, flex: "0 0 auto" }}>
              <RulerSegment label={i} />
            </div>
          ))}
          {topRemainder > 1e-6 ? (
            <div
              key="top-remainder"
              style={{
                width: `${topRemainder * ppi * zoom}px`,
                flex: "0 0 auto",
              }}
            >
              <RulerSegment label={topFull} maxFraction={topRemainder} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Left Ruler */}
      <div 
        className="absolute left-0 z-50 bg-transparent pointer-events-none overflow-hidden"
        style={{ top: `${offset}px`, height: `calc(100% - ${offset}px)`, width: `${offset}px` }}
      >
        <div className="relative w-full h-full">
          {(() => {
            const inchPx = ppi * zoom;
            const effectiveViewportHeight =
              viewportHeightPx > 0 ? viewportHeightPx : sheetHeightPx;
            const start = Math.max(0, Math.floor(scrollTopPx / (inchPx || 1)) - 2);
            const count = Math.max(
              0,
              Math.ceil(effectiveViewportHeight / (inchPx || 1)) + 4,
            );
            const end = Math.min(leftFull + 1, start + count);
            const segments: React.ReactNode[] = [];

            for (let i = start; i < end; i++) {
              const remainderFrac =
                i === leftFull && leftRemainder > 1e-6 ? leftRemainder : 1;
              const heightPx = remainderFrac * inchPx;
              const topPx = i * inchPx - scrollTopPx;

              segments.push(
                <div
                  key={i}
                  className="absolute left-0 w-full"
                  style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                >
                  <RulerSegment label={i} vertical maxFraction={remainderFrac} />
                </div>,
              );
            }

            return segments;
          })()}
        </div>
      </div>

      {/* Corner 0 Label */}
      <div 
        className="absolute top-0 left-0 z-50 bg-white flex items-center justify-center pointer-events-none"
        style={{ width: `${offset}px`, height: `${offset}px` }}
      >
        <span className="text-[9px] text-gray-500 font-medium">0</span>
      </div>
    </>
  );
}
