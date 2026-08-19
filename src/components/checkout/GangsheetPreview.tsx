import { useMemo } from "react";
import { getRenderedGroupSize } from "../artboard/lib/utils";
import { CANVAS } from "../../config/artboard.config";

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
    const sheetW = sheetWidthIn && sheetWidthIn > 0 ? sheetWidthIn : CANVAS.SHEET_WIDTH_IN;
    const maxAvailableWidth = Math.max(1e-6, sheetW - 2 * Math.max(0, marginIn));

    // Resolve each item's rendered group footprint (position + wrapped copies).
    const groups = safeItems.map((it) => {
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const rotated = it.nestRotation === 90;
      const w = Math.max(1e-6, (rotated ? it.heightIn : it.widthIn) || 0);
      const h = Math.max(1e-6, (rotated ? it.widthIn : it.heightIn) || 0);
      const group = getRenderedGroupSize(w, h, copies, maxAvailableWidth, spacingIn);
      return {
        url: it.url as string,
        posX: Math.max(0, it.posX || 0),
        posY: Math.max(0, it.posY || 0),
        cellW: w,
        cellH: h,
        rotation: it.rotation || 0,
        flipped: !!it.flipped,
        copies,
        ...group,
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
                  src={g.url}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    left: pct(cellLeftIn, g.width),
                    top: pct(cellTopIn, g.height),
                    width: pct(g.cellW, g.width),
                    height: pct(g.cellH, g.height),
                    objectFit: "contain",
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
