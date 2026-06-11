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
  flowCols?: number;
  flowStartCol?: number;
  flowEndCol?: number;
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
  _autoNestStickers: boolean,
  margin: number = 0.15
): LayoutItem[] => {
  const cellGap = Math.max(0, spacing);
  const maxWidth = canvasWidth - margin * 2;

  // Group items by exact dimensions; same-dim items share a continuous flow grid.
  const dimKey = (it: LayoutItem) =>
    `${it.widthIn.toFixed(4)}x${it.heightIn.toFixed(4)}`;

  const laneMap = new Map<string, LayoutItem[]>();
  const laneOrder: string[] = [];
  for (const it of items) {
    const key = dimKey(it);
    if (!laneMap.has(key)) { laneMap.set(key, []); laneOrder.push(key); }
    laneMap.get(key)!.push(it);
  }

  const updatesById = new Map<number, LayoutItem>();

  // nextY: top of the next available full-width row (relative to margin).
  let nextY = 0;
  // partialRow: when the previous lane's last row is partial, track its right
  // edge so the next lane can be side-packed into the leftover space.
  type PartialRowState = { y: number; h: number; rightX: number };
  let partialRow: PartialRowState | null = null;

  for (const key of laneOrder) {
    const lane = laneMap.get(key)!;
    if (lane.length === 0) continue;
    const w = lane[0].widthIn;
    const h = lane[0].heightIn;

    const savedPartialRow: PartialRowState | null = partialRow;

    // Side-pack region: a single row to the right of the previous lane's partial
    // row. Items only enter here if all of their copies fit consecutively — we
    // never split an item across regions.
    let sidePackAvailable = false;
    let sidePackStartX = 0;
    let sidePackY = 0;
    let sidePackCols = 0;
    let sidePackRowH = h;

    if (savedPartialRow !== null) {
      const sideStartX = savedPartialRow.rightX + cellGap;
      const sideAvailW = maxWidth - sideStartX;
      if (sideAvailW >= w) {
        sidePackAvailable = true;
        sidePackStartX = sideStartX;
        sidePackY = savedPartialRow.y;
        sidePackCols = Math.max(
          1,
          Math.floor((sideAvailW + cellGap) / Math.max(1e-6, w + cellGap))
        );
        sidePackRowH = Math.max(savedPartialRow.h, h);
      }
    }

    // Wrap region: full canvas width, starting at canvas left below the
    // side-pack row (or at nextY when no side-pack). Anything that doesn't fit
    // in the side-pack row flows here strictly left-to-right.
    const wrapMaxCols = Math.max(
      1,
      Math.floor((maxWidth + cellGap) / Math.max(1e-6, w + cellGap))
    );
    const wrapStartY = sidePackAvailable
      ? sidePackY + sidePackRowH + cellGap
      : nextY;

    let sideCursor = 0;
    let wrapCursor = 0;
    let wrapStarted = false;

    for (const item of lane) {
      const copies =
        typeof item.copies === "number" && item.copies > 0 ? item.copies : 1;

      const fitsInSidePack =
        sidePackAvailable && !wrapStarted && sideCursor + copies <= sidePackCols;

      if (fitsInSidePack) {
        const startCol = sideCursor;

        updatesById.set(item.id, {
          ...item,
          posX: margin + sidePackStartX + startCol * (w + cellGap),
          posY: margin + sidePackY,
          gravityActive: false,
          flowCols: copies,
          flowStartCol: 0,
          flowEndCol: copies - 1,
        });

        sideCursor += copies;
      } else {
        wrapStarted = true;
        const startIdx = wrapCursor;
        const endIdx = wrapCursor + copies - 1;
        const startCol = startIdx % wrapMaxCols;
        const startRow = Math.floor(startIdx / wrapMaxCols);
        const endCol = endIdx % wrapMaxCols;
        const endRow = Math.floor(endIdx / wrapMaxCols);
        const itemRows = endRow - startRow + 1;

        const boundingLeftCol = itemRows === 1 ? startCol : 0;
        const boundingRightCol = itemRows === 1 ? endCol : wrapMaxCols - 1;
        const boundingCols = boundingRightCol - boundingLeftCol + 1;

        updatesById.set(item.id, {
          ...item,
          posX: margin + boundingLeftCol * (w + cellGap),
          posY: margin + wrapStartY + startRow * (h + cellGap),
          gravityActive: false,
          flowCols: boundingCols,
          flowStartCol: startCol - boundingLeftCol,
          flowEndCol: endCol - boundingLeftCol,
        });

        wrapCursor += copies;
      }
    }

    if (wrapStarted) {
      const wrapRows = Math.ceil(wrapCursor / wrapMaxCols);
      const lastRowFilled = wrapCursor - (wrapRows - 1) * wrapMaxCols;
      const lastRowY = wrapStartY + (wrapRows - 1) * (h + cellGap);

      if (lastRowFilled > 0 && lastRowFilled < wrapMaxCols) {
        partialRow = {
          y: lastRowY,
          h,
          rightX: lastRowFilled * (w + cellGap) - cellGap,
        };
      } else {
        partialRow = null;
      }

      const wrapBottomY = wrapStartY + wrapRows * h + (wrapRows - 1) * cellGap;
      nextY = Math.max(nextY, wrapBottomY + cellGap);
    } else if (sideCursor > 0) {
      partialRow = {
        y: sidePackY,
        h: sidePackRowH,
        rightX: sidePackStartX + sideCursor * (w + cellGap) - cellGap,
      };
      nextY = Math.max(nextY, sidePackY + sidePackRowH + cellGap);
    }
  }

  return items.map((it) => updatesById.get(it.id) ?? it);
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
