import RulerSegment from "../rulers/RulerSegment";
import { CANVAS } from "../../../../config/artboard.config";

interface CanvasRulersProps {
  showRulers: boolean;
  zoom: number;
}

export default function CanvasRulers({ showRulers, zoom }: CanvasRulersProps) {
  if (!showRulers) return null;

  const topRulerLengthInches = 24; // Top ruler: 24 inches
  const leftRulerLengthInches = 19.5; // Left ruler: 19.5 inches
  const offset = CANVAS.RULER_OFFSET_PX;
  const ppi = CANVAS.PIXELS_PER_INCH;

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
            transform: `scaleX(${1})`, // We already scaled the width by zoom
            transformOrigin: "left center",
          }}
        >
          {Array.from({ length: topRulerLengthInches }).map((_, i) => (
            <RulerSegment key={i} label={i} />
          ))}
        </div>
      </div>

      {/* Left Ruler */}
      <div 
        className="absolute left-0 z-50 bg-transparent pointer-events-none overflow-hidden"
        style={{ top: `${offset}px`, height: `calc(100% - ${offset}px)`, width: `${offset}px` }}
      >
        <div
          className="w-full flex flex-col"
          style={{
            height: `${leftRulerLengthInches * ppi * zoom}px`,
            transform: `scaleY(${1})`, // We already scaled the height by zoom
            transformOrigin: "top left",
          }}
        >
          {Array.from({ length: Math.floor(leftRulerLengthInches) + 1 }).map((_, i) => (
            <RulerSegment key={i} label={i} vertical />
          ))}
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
