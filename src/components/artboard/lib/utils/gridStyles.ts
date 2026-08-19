import { GRID, CANVAS } from "../../../../config/artboard.config";

/**
 * Two-tone checker colors [checkerSquare, backgroundColor] per bg id.
 * Shared between sidebar swatches and the live canvas background renderer.
 */
export const CHECKER_PAIRS: Record<string, readonly [string, string]> = {
  transparent: ['#E9F2F1', '#ffffff'],
  '#ffffff':   ['#e0e0e0', '#ffffff'],
  '#f3f4f6':   ['#d1d5db', '#f3f4f6'],
  '#9ca3af':   ['#6b7280', '#9ca3af'],
  '#4b5563':   ['#374151', '#4b5563'],
  '#111827':   ['#000000', '#374151'],
  '#ef4444':   ['#b91c1c', '#ef4444'],
  '#f59e0b':   ['#b45309', '#f59e0b'],
  '#22c55e':   ['#15803d', '#22c55e'],
  '#6366f1':   ['#3730a3', '#6366f1'],
  '#a855f7':   ['#7e22ce', '#a855f7'],
  '#ec4899':   ['#be185d', '#ec4899'],
};

/**
 * Generates a two-tone CSS checkerboard scaled to the current zoom.
 * Defaults to the standard grey/white transparency-indicator pattern.
 */
export const getGridStyle = (
  zoom: number,
  c1 = '#a8a8a8',
  c2 = '#ffffff',
): React.CSSProperties => {
  const smallGrid = GRID.SIZE / GRID.SMALL_GRID_DIVISOR;
  const half = smallGrid / 2;
  const sz   = smallGrid * zoom;
  const szH  = half      * zoom;

  return {
    backgroundImage: [
      `linear-gradient(45deg,  ${c1} 25%, transparent 25%)`,
      `linear-gradient(-45deg, ${c1} 25%, transparent 25%)`,
      `linear-gradient(45deg,  transparent 75%, ${c1} 75%)`,
      `linear-gradient(-45deg, transparent 75%, ${c1} 75%)`,
    ].join(', '),
    backgroundSize:     `${sz}px ${sz}px, ${sz}px ${sz}px, ${sz}px ${sz}px, ${sz}px ${sz}px`,
    backgroundPosition: `0 0, 0 ${szH}px, ${szH}px -${szH}px, -${szH}px 0px`,
    backgroundColor: c2,
  };
};

/**
 * Returns true when the background has low perceived luminance and canvas UI
 * elements (rulers, guides, labels) should be rendered in light colours.
 */
export function isDarkBg(bgId: string): boolean {
  if (bgId === 'rainbow') return true;
  if (!bgId.startsWith('#') || bgId.length !== 7) return false;
  const r = parseInt(bgId.slice(1, 3), 16) / 255;
  const g = parseInt(bgId.slice(3, 5), 16) / 255;
  const b = parseInt(bgId.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.70;
}

export const snapToGridPoint = (value: number, gridSize: number = GRID.SIZE): number =>
  Math.round(value / (gridSize / CANVAS.PIXELS_PER_INCH)) * (gridSize / CANVAS.PIXELS_PER_INCH);
