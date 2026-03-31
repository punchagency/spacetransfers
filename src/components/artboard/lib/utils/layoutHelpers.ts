export interface LayoutItem {
  id: number;
  widthIn: number;
  heightIn: number;
  posX: number;
  posY: number;
  gravityActive?: boolean;
  copies?: number;
}

const getGroupSize = (width: number, height: number, copies: number = 1, gap: number = 0.05) => {
  if (copies <= 1) return { width, height };
  const cols = Math.ceil(Math.sqrt(copies));
  const rows = Math.ceil(copies / cols);
  return {
    width: cols * width + (cols - 1) * gap,
    height: rows * height + (rows - 1) * gap
  };
};      

export const calculateGridLayout = (
  items: LayoutItem[],
  canvasWidth: number,
  spacing: number,
  autoNestStickers: boolean,
  margin: number = 0.15
): LayoutItem[] => {
  const selectionBuffer = 0.084; // Room for blue selection ring (4px) to stay within margin
  const tightGapIn = 2 / 96;
  const minSpacing = autoNestStickers
    ? Math.min(Math.max(spacing, 0), tightGapIn)
    : Math.max(spacing, 0.08);
  const maxWidth = canvasWidth - margin * 2;

  const enriched = items.map((it) => {
    const { width, height } = getGroupSize(it.widthIn, it.heightIn, it.copies);
    const packedWidth = width + selectionBuffer;
    const packedHeight = height + selectionBuffer;
    return {  
      it,
      packedWidth,
      packedHeight,
      footprint: packedWidth * packedHeight,
    };
  });

  const ordered = enriched;

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
  const selectionBuffer = 0.084;
  const minSpacing = Math.max(spacing, 0.3);
  const maxWidth = canvasWidth - margin * 2;
  const allItems = [...items, newItem];

  const rows: LayoutItem[][] = [];
  let currentRow: LayoutItem[] = [];
  let currentRowWidth = 0;

  allItems.forEach((it) => {
    const { width } = getGroupSize(it.widthIn, it.heightIn, it.copies);
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
      const { width } = getGroupSize(it.widthIn, it.heightIn, it.copies);
      return sum + (width + selectionBuffer) + (idx > 0 ? minSpacing : 0);
    }, 0);
    let currentX = margin + (maxWidth - rowWidth) / 2;
    const maxHeight = Math.max(...row.map((it) => {
      const { height } = getGroupSize(it.widthIn, it.heightIn, it.copies);
      return height + selectionBuffer;
    }));

    for (const it of row) {
      if (it.id === newItem.id) {
        targetX = currentX + selectionBuffer / 2;
        found = true;
        break;
      }
      const { width } = getGroupSize(it.widthIn, it.heightIn, it.copies);
      currentX += width + selectionBuffer + minSpacing;
    }

    if (found) break;
    targetY += maxHeight + minSpacing;
  }

  return { targetX, targetY };
};
