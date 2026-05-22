import { CANVAS } from "../../../../config/artboard.config";

const MAX_SHEET_HEIGHT_IN = 1200;

/**
 * Returns how many copies of an item can physically fit within the 1200" sheet
 * height limit, capped at whatever the user requested.
 */
export function computeRenderCopies(
  item: { widthIn: number; heightIn: number; copies: number },
  canvasWidthIn: number,
  marginIn: number,
  spacingIn: number
): number {
  const effectiveMargin = Math.max(0, marginIn);
  const gap = spacingIn;
  const maxAvailableWidth = Math.max(0, canvasWidthIn - 2 * effectiveMargin);
  const scaledWidth = Math.max(1e-6, item.widthIn);
  const scaledHeight = Math.max(1e-6, item.heightIn);

  const capacityCols = Math.max(
    1,
    Math.floor((maxAvailableWidth + gap) / (scaledWidth + gap))
  );
  const maxGroupHeightAllowedIn = Math.max(0, MAX_SHEET_HEIGHT_IN - effectiveMargin);
  const maxRows = Math.max(
    1,
    Math.floor((maxGroupHeightAllowedIn + gap) / (scaledHeight + gap))
  );
  const visibleColsCandidate = Math.max(1, Math.min(item.copies, capacityCols));
  const maxCopiesThatFit = Math.max(1, maxRows * visibleColsCandidate);
  return Math.max(1, Math.min(item.copies, maxCopiesThatFit));
}

export interface LayoutItem {
  id: number;
  widthIn: number;
  heightIn: number;
  posX: number;
  posY: number;
  gravityActive?: boolean;
  copies?: number;
}

export const getRenderedGroupSize = (
  widthIn: number,
  heightIn: number,
  copies: number = 1,
  maxAvailableWidthIn: number,
  gapIn: number = CANVAS.GRID_GAP_IN
) => {
  const w = Math.max(0, Number(widthIn || 0));
  const h = Math.max(0, Number(heightIn || 0));
  const c = Math.max(1, Number(copies || 1));

  if (c <= 1) return { width: w, height: h, cols: 1, rows: 1 };

  const capacityCols = Math.max(
    1,
    Math.floor((maxAvailableWidthIn + gapIn) / Math.max(1e-6, w + gapIn))
  );
  const cols = Math.max(1, Math.min(c, capacityCols));
  const rows = Math.max(1, Math.ceil(c / capacityCols));

  const widthRaw = cols * w + (cols - 1) * gapIn;
  const width = Math.min(widthRaw, Math.max(0, maxAvailableWidthIn));
  const height = rows * h + (rows - 1) * gapIn;

  return { width, height, cols, rows };
};

export const getRenderedBounds = (
  item: LayoutItem,
  canvasWidthIn: number,
  marginIn: number
) => {
  const effectiveMargin = Math.max(0, Number(marginIn || 0));
  const maxAvailableWidth = Math.max(0, canvasWidthIn - 2 * effectiveMargin);
  const copies = typeof item.copies === "number" && item.copies > 0 ? item.copies : 1;
  const group = getRenderedGroupSize(item.widthIn, item.heightIn, copies, maxAvailableWidth);

  const centeredLeft = effectiveMargin + (maxAvailableWidth - group.width) / 2;
  const rightBoundLeft = canvasWidthIn - effectiveMargin - group.width;
  const left =
    copies > 1
      ? Math.max(effectiveMargin, Math.min(centeredLeft, rightBoundLeft))
      : Math.max(effectiveMargin, item.posX);

  const MAX_SHEET_HEIGHT_IN = 1200;
  const bottomLimitTop = MAX_SHEET_HEIGHT_IN - group.height;
  const top = Math.min(item.posY, bottomLimitTop);

  return {
    left,
    top,
    right: left + group.width,
    bottom: top + group.height,
    width: group.width,
    height: group.height,
  };
};

export const calculateGridLayout = (
  items: LayoutItem[],
  canvasWidth: number,
  spacing: number,
  autoNestStickers: boolean,
  margin: number = 0.15
): LayoutItem[] => {
  const selectionBuffer = CANVAS.SELECTION_BUFFER_IN;
  const tightGapIn = 2 / 96;
  const minSpacing = autoNestStickers
    ? Math.min(Math.max(spacing, 0), tightGapIn)
    : Math.max(spacing, 0.08);
  const maxWidth = canvasWidth - margin * 2;

  const enriched = items.map((it, idx) => {
    const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
    const { width, height } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
    const packedWidth = width + selectionBuffer;
    const packedHeight = height + selectionBuffer;
    return {
      it,
      idx,
      isGroup: copies > 1,
      packedWidth,
      packedHeight,
      footprint: packedWidth * packedHeight,
    };
  });

  const ordered = [
    ...enriched.filter((e) => e.isGroup).sort((a, b) => a.idx - b.idx),
    ...enriched.filter((e) => !e.isGroup).sort((a, b) => a.idx - b.idx),
  ];

  const placed: Array<{
    it: any;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];

  ordered.forEach((entry) => {
    const w = entry.packedWidth + minSpacing;
    const h = entry.packedHeight + minSpacing;

    const xCoords = [0, ...placed.map((p) => p.x + p.w), ...placed.map((p) => p.x)];
    const yCoords = [0, ...placed.map((p) => p.y + p.h), ...placed.map((p) => p.y)];

    const uniqueX = Array.from(new Set(xCoords)).sort((a, b) => a - b);
    const uniqueY = Array.from(new Set(yCoords)).sort((a, b) => a - b);

    let bestPos = { x: 0, y: 0 };
    let found = false;
    const eps = 1e-4;

    for (const y of uniqueY) {
      for (const x of uniqueX) {
        if (x + w > maxWidth + eps) continue;

        let overlaps = false;
        for (const p of placed) {
          if (
            x + eps < p.x + p.w &&
            x + w - eps > p.x &&
            y + eps < p.y + p.h &&
            y + h - eps > p.y
          ) {
            overlaps = true;
            break;
          }
        }

        if (!overlaps) {
          bestPos = { x, y };
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      // Fallback if something goes wrong, though shouldn't happen
      const maxY = placed.length > 0 ? Math.max(...placed.map(p => p.y + p.h)) : 0;
      bestPos = { x: 0, y: maxY };
    }

    placed.push({
      it: entry.it,
      x: bestPos.x,
      y: bestPos.y,
      w,
      h,
    });
  });

  const updates: LayoutItem[] = placed.map((p) => ({
    ...p.it,
    posX: margin + p.x + selectionBuffer / 2,
    posY: margin + p.y + selectionBuffer / 2 + 0.02,
    gravityActive: false,
  }));

  return updates;
};

export const calculateDropPosition = (
  items: LayoutItem[],
  newItem: LayoutItem,
  canvasWidth: number,
  topCenterY: number,
  spacing: number = 0.5,
  margin: number = 0.15
): { targetX: number; targetY: number } => {
  const selectionBuffer = CANVAS.SELECTION_BUFFER_IN;
  const minSpacing = Math.max(spacing, 0.3);
  const maxWidth = canvasWidth - margin * 2;
  const allItems = [...items, newItem];

  const rows: LayoutItem[][] = [];
  let currentRow: LayoutItem[] = [];
  let currentRowWidth = 0;

  allItems.forEach((it) => {
    const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
    const { width } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
    const itemWidth = width + selectionBuffer + minSpacing;
    if (currentRowWidth + itemWidth > maxWidth && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [it];
      currentRowWidth = itemWidth;
    } else {
      currentRow.push(it);
      currentRowWidth += itemWidth;
    }
  });
  if (currentRow.length > 0) rows.push(currentRow);

  let targetX = canvasWidth / 2;
  let targetY = margin + selectionBuffer / 2 + 0.02;
  let found = false;

  for (const row of rows) {
    const rowWidth = row.reduce((sum, it, idx) => {
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const { width } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
      return sum + (width + selectionBuffer) + (idx > 0 ? minSpacing : 0);
    }, 0);
    let currentX = margin + (maxWidth - rowWidth) / 2;
    const maxHeight = Math.max(...row.map((it) => {
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const { height } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
      return height + selectionBuffer;
    }));

    for (const it of row) {
      if (it.id === newItem.id) {
        targetX = currentX + selectionBuffer / 2;
        found = true;
        break;
      }
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const { width } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
      currentX += width + selectionBuffer + minSpacing;
    }

    if (found) break;
    targetY += maxHeight + minSpacing;
  }

  return { targetX, targetY };
};
