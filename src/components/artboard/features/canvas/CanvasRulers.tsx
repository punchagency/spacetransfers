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

  // The left ruler always spans the full sheet capacity (1200 in) so it never
  // truncates based on how copies happen to fill the canvas. Content heights
  // like 1181" or 1105" are artefacts of (image height + gap) not dividing
  // evenly into 1200; the ruler must ignore that and show the defined maximum.
  const MAX_RULER_HEIGHT_IN = 1200;
  const hasContent = sheetHeightPx > 0;
  const totalHeightIn = hasContent ? MAX_RULER_HEIGHT_IN : 0;
  const leftFull = Math.floor(totalHeightIn); // 1200 when content present
  const leftRemainder = totalHeightIn - leftFull; // 0 (1200 is exact integer)

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
      {(() => {
        // Container height tracks the ruler's defined capacity (1200 in), not
        // the content height, so the ruler always fills the viewport rather than
        // stopping short at whatever the current canvas height happens to be.
        const effectiveViewportHeight =
          viewportHeightPx > 0 ? viewportHeightPx : sheetHeightPx;
        const rulerTotalPx = hasContent ? MAX_RULER_HEIGHT_IN * ppi * zoom : 0;
        const visibleRulerPx = Math.max(0, rulerTotalPx - scrollTopPx);
        const leftRulerHeightPx = Math.max(
          0,
          Math.min(effectiveViewportHeight, visibleRulerPx),
        );

        return (
          <div
            className="absolute left-0 z-50 bg-transparent pointer-events-none overflow-hidden"
            style={{
              top: `${offset}px`,
              height: `${leftRulerHeightPx}px`,
              width: `${offset}px`,
            }}
          >
            <div className="relative w-full h-full">
              {(() => {
                const inchPx = ppi * zoom;
                const start = Math.max(
                  0,
                  Math.floor(scrollTopPx / (inchPx || 1)) - 2,
                );
                const count = Math.max(
                  0,
                  Math.ceil(effectiveViewportHeight / (inchPx || 1)) + 4,
                );
                // Stop exactly at ceil(totalHeightIn): when sheet height is an
                // integer number of inches, leftFull + 1 would render an extra
                // full-inch tick past the sheet's bottom.
                const totalSegments = Math.ceil(totalHeightIn);
                const end = Math.min(totalSegments, start + count);
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
                      <RulerSegment
                        label={i}
                        vertical
                        maxFraction={remainderFrac}
                      />
                    </div>,
                  );
                }

                return segments;
              })()}
            </div>
          </div>
        );
      })()}

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
