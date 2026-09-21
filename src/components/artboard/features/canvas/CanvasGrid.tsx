import { CANVAS, GRID } from "../../../../config/artboard.config";

/**
 * The grid "Snap to Grid" snaps to.
 *
 * Quarter-inch lines with a stronger line every inch, starting at the sheet's
 * top-left corner — so every strong line lands on a ruler mark, and the step is
 * exactly what `snapToGridPoint` rounds to (`GRID.MINOR_IN`).
 *
 * It used to step every 20 canvas pixels (0.208in, stronger every 0.833in): no
 * line met an inch mark, so the grid could not be used to measure anything.
 *
 * Drawn in unscaled pixels: the canvas element carries `transform: scale(zoom)`,
 * so multiplying by zoom here would apply it twice — the same convention
 * `CanvasMargins` follows.
 */

interface CanvasGridProps {
  showGrid: boolean;
  /** The roll width, so the grid stops at the sheet's edge. */
  sheetWidthIn: number;
  /** Sheet height in inches, so the grid stops with the sheet. */
  heightIn: number;
  isDarkBg?: boolean;
}

export default function CanvasGrid({ showGrid, sheetWidthIn, heightIn, isDarkBg = false }: CanvasGridProps) {
  if (!showGrid || heightIn <= 0) return null;

  const ppi = CANVAS.PIXELS_PER_INCH;
  const minorPx = GRID.MINOR_IN * ppi;
  const majorPx = GRID.MAJOR_IN * ppi;

  const minor = isDarkBg ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.07)";
  const major = isDarkBg ? "rgba(255,255,255,0.22)" : "rgba(15,23,42,0.16)";

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      // Beneath the margin guide (15) and the items, above the sheet surface.
      style={{
        zIndex: 5,
        width: `${sheetWidthIn * ppi}px`,
        height: `${heightIn * ppi}px`,
        backgroundImage: [
          `linear-gradient(to right, ${major} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${major} 1px, transparent 1px)`,
          `linear-gradient(to right, ${minor} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${minor} 1px, transparent 1px)`,
        ].join(", "),
        backgroundSize: [
          `${majorPx}px ${majorPx}px`,
          `${majorPx}px ${majorPx}px`,
          `${minorPx}px ${minorPx}px`,
          `${minorPx}px ${minorPx}px`,
        ].join(", "),
      }}
      aria-hidden
    />
  );
}
