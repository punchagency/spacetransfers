import { useMemo } from "react";
import { computeGroupDims } from "../artboard/lib/utils";
import { CANVAS } from "../../config/artboard.config";
import { getSheetWidthIn } from "../../lib/utils/pricingRates";

interface PreviewSubItem {
  id?: number;
  url?: string;
  posX?: number;
  posY?: number;
  widthIn?: number;
  heightIn?: number;
  rotation?: number;
  flipped?: boolean;
  copies?: number;
  nestRotation?: 0 | 90;
  flowCols?: number;
}

interface GangsheetPreviewProps {
  items: PreviewSubItem[];
  /** Full sheet dimensions in inches. Falls back to the default sheet width and
   *  a content-derived height when not provided. */
  sheetWidthIn?: number;
  sheetHeightIn?: number;
  marginIn?: number;
  spacingIn?: number;
  /** Bounds (px) the preview must fit inside. The rendered sheet is scaled to
   *  fit within BOTH while preserving aspect ratio, so no edge is ever clipped. */
  maxWidth: number;
  maxHeight: number;
  className?: string;
}

/**
 * Accurate, non-cropping thumbnail of a gang sheet. Renders a scaled replica of
 * the artboard: the sheet keeps its true aspect ratio and every item sits at its
 * real position/size (copies tiled into their wrapped grid, matching the canvas).
 * The whole sheet is scaled with `object-contain` semantics — it fits entirely
 * within the given bounds, so all four edges and corners stay visible regardless
 * of the sheet's dimensions or orientation.
 */
export default function GangsheetPreview({
  items,
  sheetWidthIn,
  sheetHeightIn,
  marginIn = 0,
  spacingIn = CANVAS.GRID_GAP_IN,
  maxWidth,
  maxHeight,
  className,
}: GangsheetPreviewProps) {
  const layout = useMemo(() => {
    const safeItems = Array.isArray(items) ? items.filter((it) => it && it.url) : [];
    const sheetW = sheetWidthIn && sheetWidthIn > 0 ? sheetWidthIn : getSheetWidthIn();
    const maxAvailableWidth = Math.max(1e-6, sheetW - 2 * Math.max(0, marginIn));

    /*
     * Each item laid out the way the artboard draws it and the export prints
     * it: the cell swaps for auto-nest's quarter turn, copies wrap at the
     * columns auto-nest chose, and the image is drawn at its own upright size
     * and turned into the cell. This preview used as many columns as fit and
     * ignored the nest turn, so the sheet shown at checkout could differ from
     * the one just built.
     */
    const groups = safeItems.map((it) => {
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const widthIn = Math.max(1e-6, it.widthIn || 0);
      const heightIn = Math.max(1e-6, it.heightIn || 0);
      const nested = it.nestRotation === 90;
      const cellW = nested ? heightIn : widthIn;
      const cellH = nested ? widthIn : heightIn;
      const rotation = it.rotation || 0;
      const oddQuarter = ((Math.round(rotation / 90) % 2) + 2) % 2 === 1;
      const cols =
        typeof it.flowCols === "number" && it.flowCols >= 1
          ? Math.min(copies, Math.floor(it.flowCols))
          : computeGroupDims(cellW, cellH, copies, maxAvailableWidth, spacingIn).cols;
      const rows = Math.ceil(copies / cols);
      return {
        url: it.url as string,
        posX: Math.max(0, it.posX || 0),
        posY: Math.max(0, it.posY || 0),
        cellW,
        cellH,
        imageW: oddQuarter ? heightIn : widthIn,
        imageH: oddQuarter ? widthIn : heightIn,
        rotation: rotation + (nested ? 90 : 0),
        flipped: !!it.flipped,
        copies,
        cols,
        width: cols * cellW + (cols - 1) * spacingIn,
        height: rows * cellH + (rows - 1) * spacingIn,
      };
    });

    // Smart crop: compute the tight bounding box of ALL occupied content (the
    // union of every item's footprint). Sections separated by empty space are
    // all included because we span from the top-most to the bottom-most item —
    // only the empty margins BEYOND the content are trimmed away, so the preview
    // is a focused view of what's actually printed instead of a long, mostly
    // blank sheet.
    const contentMinX = groups.reduce((m, g) => Math.min(m, g.posX), Infinity);
    const contentMinY = groups.reduce((m, g) => Math.min(m, g.posY), Infinity);
    const contentMaxX = groups.reduce((m, g) => Math.max(m, g.posX + g.width), 0);
    const contentMaxY = groups.reduce((m, g) => Math.max(m, g.posY + g.height), 0);

    // Pad by the sheet margin so the printable margin around the artwork stays
    // visible, then clamp to the real sheet bounds (never show past the sheet
    // edge, never above y=0). Content that legitimately exceeds the sheet is
    // still fully included via the max() with the content extent.
    const pad = Math.max(0, marginIn);
    const viewMinX = Math.max(0, contentMinX - pad);
    const viewMinY = Math.max(0, contentMinY - pad);
    const sheetRight =
      sheetWidthIn && sheetWidthIn > 0 ? sheetWidthIn : contentMaxX;
    const viewMaxX = Math.min(Math.max(sheetRight, contentMaxX), contentMaxX + pad);
    const sheetBottom =
      sheetHeightIn && sheetHeightIn > 0 ? sheetHeightIn : contentMaxY;
    const viewMaxY = Math.min(Math.max(sheetBottom, contentMaxY), contentMaxY + pad);

    const viewW = Math.max(1e-6, viewMaxX - viewMinX);
    const viewH = Math.max(1e-6, viewMaxY - viewMinY);

    // Scale the cropped viewport to fit within both bounds (contain), keeping AR.
    const scale = Math.min(maxWidth / viewW, maxHeight / viewH);
    return {
      groups,
      viewMinX,
      viewMinY,
      viewW,
      viewH,
      renderW: viewW * scale,
      renderH: viewH * scale,
    };
  }, [items, sheetWidthIn, sheetHeightIn, marginIn, spacingIn, maxWidth, maxHeight]);

  const { groups, viewMinX, viewMinY, viewW, viewH, renderW, renderH } = layout;

  if (groups.length === 0) {
    return (
      <div
        className={className}
        style={{
          width: maxWidth,
          height: maxHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="text-3xl">📋</span>
      </div>
    );
  }

  const pct = (n: number, d: number) => `${(n / d) * 100}%`;

  return (
    // Outer box reserves the full available area and centers the scaled sheet.
    <div
      className={className}
      style={{
        width: maxWidth,
        height: maxHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* The cropped printable area — exact aspect ratio, fully contained so
          every visible edge and corner of the occupied region stays in view. */}
      <div
        style={{
          position: "relative",
          width: renderW,
          height: renderH,
          background: "#ffffff",
          borderRadius: 2,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
          overflow: "hidden",
        }}
      >
        {groups.map((g, gi) => (
          <div
            key={gi}
            style={{
              position: "absolute",
              // Positioned relative to the cropped viewport origin.
              left: pct(g.posX - viewMinX, viewW),
              top: pct(g.posY - viewMinY, viewH),
              width: pct(g.width, viewW),
              height: pct(g.height, viewH),
            }}
          >
            {Array.from({ length: g.copies }, (_, i) => {
              const col = i % g.cols;
              const row = Math.floor(i / g.cols);
              const cellLeftIn = col * (g.cellW + spacingIn);
              const cellTopIn = row * (g.cellH + spacingIn);
              return (
                <img
                  key={i}
                  // Same CORS mode as the board, so neither leaves a cached copy the other can't read.
                  crossOrigin="anonymous"
                  src={g.url}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    // Centred in the cell at its own upright size, then turned,
                    // so a quarter turn fills the cell exactly.
                    left: pct(cellLeftIn + (g.cellW - g.imageW) / 2, g.width),
                    top: pct(cellTopIn + (g.cellH - g.imageH) / 2, g.height),
                    width: pct(g.imageW, g.width),
                    height: pct(g.imageH, g.height),
                    maxWidth: "none",
                    maxHeight: "none",
                    // As the board and the print file draw it.
                    objectFit: "fill",
                    transform: `scaleX(${g.flipped ? -1 : 1}) rotate(${g.rotation}deg)`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
