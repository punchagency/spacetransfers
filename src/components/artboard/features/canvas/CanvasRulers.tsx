import RulerSegment from "../rulers/RulerSegment";
// import { CANVAS } from "../../../../config/artboard.config";

interface CanvasRulersProps {
  showRulers: boolean;
  zoom: number;
}

export default function CanvasRulers({ showRulers, zoom }: CanvasRulersProps) {
  if (!showRulers) return null;

  const topRulerLengthInches = 24; // Top ruler: 24 inches
  const leftRulerLengthInches = 19.5; // Left ruler: 19.5 inches

  return (
    <>
      {/* Top Ruler */}
      <div className="absolute top-0 left-8 w-full h-8 z-50 bg-transparent pointer-events-none overflow-hidden">
        <div
          className="h-full flex"
          style={{
            width: `${(1 / zoom) * 100}%`,
            transform: `scaleX(${zoom})`,
            transformOrigin: "left center",
          }}
        >
          {Array.from({ length: topRulerLengthInches + 1 }).map((_, i) => (
            <RulerSegment key={i} label={i} />
          ))}
        </div>
      </div>

      {/* Left Ruler */}
      <div className="absolute top-8 left-0 h-full w-8 z-50 bg-transparent pointer-events-none overflow-hidden">
        <div
          className="w-full flex flex-col"
          style={{
            height: `${(1 / zoom) * 100}%`,
            transform: `scaleY(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          {Array.from({ length: leftRulerLengthInches + 1 }).map((_, i) => (
            <RulerSegment key={i} label={i} vertical />
          ))}
        </div>
      </div>

      {/* Corner 0 Label */}
      <div className="absolute top-0 left-0 w-8 h-8 z-50 bg-white flex items-center justify-center pointer-events-none">
        <span className="text-[9px] text-gray-500 font-medium">0</span>
      </div>
    </>
  );
}
