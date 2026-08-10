import RulerSegment from "../rulers/RulerSegment";
import { CANVAS } from "../../../../config/artboard.config";
import { isDarkBg as computeIsDark } from "../../lib/utils";

interface CanvasRulersProps {
  showRulers: boolean;
  zoom: number;
  sheetHeightPx: number;
  scrollTopPx: number;
  viewportHeightPx: number;
  canvasBg?: string;
}

export default function CanvasRulers({
  showRulers,
  zoom,
  sheetHeightPx,
  scrollTopPx,
  viewportHeightPx,
  canvasBg,
}: CanvasRulersProps) {
  if (!showRulers) return null;

  const dark = computeIsDark(canvasBg ?? 'transparent');
  const cornerTextCls = dark ? 'text-white' : 'text-gray-500';

  const topRulerLengthInches = 23.5;
  const offset = CANVAS.RULER_OFFSET_PX;
  const ppi    = CANVAS.PIXELS_PER_INCH;

  const topFull      = Math.floor(topRulerLengthInches);
  const topRemainder = topRulerLengthInches - topFull;

  const MAX_RULER_HEIGHT_IN = 1200;
  const hasContent   = sheetHeightPx > 0;
  const totalHeightIn = hasContent ? MAX_RULER_HEIGHT_IN : 0;
  const leftFull      = Math.floor(totalHeightIn);
  const leftRemainder = totalHeightIn - leftFull;

  const fitScale = 1;

  return (
    <>
      {/* Top Ruler */}
      <div
        className="absolute top-0 z-50 pointer-events-none overflow-hidden bg-transparent"
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
              <RulerSegment label={i} isDarkBg={dark} />
            </div>
          ))}
          {topRemainder > 1e-6 ? (
            <div key="top-remainder" style={{ width: `${topRemainder * ppi * zoom}px`, flex: "0 0 auto" }}>
              <RulerSegment label={topFull} maxFraction={topRemainder} isDarkBg={dark} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Left Ruler */}
      {(() => {
        const effectiveViewportHeight = viewportHeightPx > 0 ? viewportHeightPx : sheetHeightPx;
        const rulerTotalPx  = hasContent ? MAX_RULER_HEIGHT_IN * ppi * zoom : 0;
        const visibleRulerPx = Math.max(0, rulerTotalPx - scrollTopPx);
        const leftRulerHeightPx = Math.max(0, Math.min(effectiveViewportHeight, visibleRulerPx));

        return (
          <div
            className="absolute left-0 z-50 pointer-events-none overflow-hidden bg-transparent"
            style={{
              top:    `${offset}px`,
              height: `${leftRulerHeightPx}px`,
              width:  `${offset}px`,
            }}
          >
            <div className="relative w-full h-full">
              {(() => {
                const inchPx = ppi * zoom;
                const start  = Math.max(0, Math.floor(scrollTopPx / (inchPx || 1)) - 2);
                const count  = Math.max(0, Math.ceil(effectiveViewportHeight / (inchPx || 1)) + 4);
                const totalSegments = Math.ceil(totalHeightIn);
                const end   = Math.min(totalSegments, start + count);
                const segments: React.ReactNode[] = [];

                for (let i = start; i < end; i++) {
                  const remainderFrac = i === leftFull && leftRemainder > 1e-6 ? leftRemainder : 1;
                  const heightPx = remainderFrac * inchPx;
                  const topPx    = i * inchPx - scrollTopPx;

                  segments.push(
                    <div key={i} className="absolute left-0 w-full" style={{ top: `${topPx}px`, height: `${heightPx}px` }}>
                      <RulerSegment label={i} vertical maxFraction={remainderFrac} isDarkBg={dark} />
                    </div>,
                  );
                }

                return segments;
              })()}
            </div>
          </div>
        );
      })()}

      {/* Corner 0 label */}
      <div
        className="absolute top-0 left-0 z-50 flex items-center justify-center pointer-events-none bg-transparent"
        style={{ width: `${offset}px`, height: `${offset}px` }}
      >
        <span className={`text-[9px] font-normal ${cornerTextCls}`}>0</span>
      </div>
    </>
  );
}
