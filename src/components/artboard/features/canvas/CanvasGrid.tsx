import { CANVAS, GRID } from "../../../../config/artboard.config";

/**
 * The grid "Snap to Grid" snaps to.
 *
 * `showGrid` was passed from the sidebar, through the editor, into `Artboard` —
 * and then used by nothing. There was no grid renderer at all, so the toggle had
 * no effect while Snap to Grid, which is fully wired, quietly aligned items to
 * an invisible lattice.
 *
 * Spacing here is `GRID.SIZE` in canvas pixels, which is exactly what
 * `snapToGridPoint` rounds to (`GRID.SIZE / PIXELS_PER_INCH` inches). If one
 * changes the other follows, so what you see is always what you snap to.
 *
 * Drawn in unscaled pixels: the canvas element carries `transform: scale(zoom)`,
 * so multiplying by zoom here would apply it twice — the same convention
 * `CanvasMargins` follows.
 */

interface CanvasGridProps {
  showGrid: boolean;
  /** Sheet height in inches, so the grid stops with the sheet. */
  heightIn: number;
  isDarkBg?: boolean;
}

export default function CanvasGrid({ showGrid, heightIn, isDarkBg = false }: CanvasGridProps) {
  if (!showGrid || heightIn <= 0) return null;

  const ppi = CANVAS.PIXELS_PER_INCH;
  const step = GRID.SIZE;
  // Every fourth line is stronger, so the eye has something to measure against
  // without the fine lines becoming noise.
  const majorStep = step * 4;

  const minor = isDarkBg ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.07)";
  const major = isDarkBg ? "rgba(255,255,255,0.20)" : "rgba(15,23,42,0.14)";

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      // Beneath the margin guide (15) and the items, above the background.
      style={{
        zIndex: 5,
        width: `${CANVAS.SHEET_WIDTH_IN * ppi}px`,
        height: `${heightIn * ppi}px`,
        backgroundImage: [
          `linear-gradient(to right, ${major} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${major} 1px, transparent 1px)`,
          `linear-gradient(to right, ${minor} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${minor} 1px, transparent 1px)`,
        ].join(", "),
        backgroundSize: [
          `${majorStep}px ${majorStep}px`,
          `${majorStep}px ${majorStep}px`,
          `${step}px ${step}px`,
          `${step}px ${step}px`,
        ].join(", "),
      }}
      aria-hidden
    />
  );
}
