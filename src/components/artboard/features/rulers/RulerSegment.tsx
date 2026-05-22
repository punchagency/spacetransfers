import { CANVAS } from "../../../../config/artboard.config";

export default function RulerSegment({
  vertical = false,
  label,
  maxFraction = 1,
}: {
  vertical?: boolean;
  label: number;
  maxFraction?: number;
}) {
  // Positions are defined as fractions of the segment (0–1),
  // mapped from the original ticks over a base (PPI).
  const base = CANVAS.PIXELS_PER_INCH;
  const rawTicks = [12, 24, 36, 48, 60, 72, 84].map(t => t * (base / 96));
  const ticks = rawTicks.map((pos) => ({
    pos: pos / base,
    size: pos === base / 2 ? "large" : pos === base / 4 || pos === (3 * base) / 4 ? "medium" : "small",
  })).filter((t) => t.pos <= maxFraction + 1e-6);

  const labelPosClass = vertical ? "top-1 right-1" : "top-4 left-1";

  return (
    <div
      className={`relative ${vertical
        ? "flex-1 w-full h-full border-t border-gray-300"
        : "flex-1 h-full border-l border-gray-300"
        }`}
    >
      {label !== 0 && (
        <span
          className={`absolute text-[9px] text-gray-500 font-medium select-none whitespace-nowrap ${labelPosClass}`}
        >
          {label}
        </span>
      )}
      {ticks.map((tick) => {
        const lengthPx =
          tick.size === "large" ? 12 : tick.size === "medium" ? 8 : 5;

        const style = vertical
          ? {
            top: `${tick.pos * 100}%`,
            left: 0,
            width: `${lengthPx}px`,
            height: "1px",
            transform: "translateY(-0.5px)",
          }
          : {
            left: `${tick.pos * 100}%`,
            top: 0,
            height: `${lengthPx}px`,
            width: "1px",
            transform: "translateX(-0.5px)",
          };

        return <div key={tick.pos} className="absolute bg-gray-400" style={style} />;
      })}
    </div>
  );
}
