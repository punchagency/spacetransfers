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
  const minSpacing = Math.max(spacing, 0.3); // Increased from 0.15 to 0.3 inches to prevent overlap
  const maxWidth = canvasWidth - margin * 2;
  const rows: LayoutItem[][] = [];
  let currentRow: LayoutItem[] = [];
  let currentRowWidth = 0;

  items.forEach((it) => {
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

  let currentY = margin + 0.02;
  const updates = rows.flatMap((row) => {
    const rowWidth = row.reduce((sum, it, idx) => {
      const { width } = getGroupSize(it.widthIn, it.heightIn, it.copies);
      return sum + (width + selectionBuffer) + (idx > 0 ? minSpacing : 0);
    }, 0);

    let currentX = margin + (maxWidth - rowWidth) / 2;
    const maxHeight = Math.max(...row.map((it) => {
      const { height } = getGroupSize(it.widthIn, it.heightIn, it.copies);
      return height + selectionBuffer;
    }));

    const rowItems = row.map((it) => {
      const { width } = getGroupSize(it.widthIn, it.heightIn, it.copies);
      const result = { ...it, posX: currentX + selectionBuffer / 2, posY: currentY + selectionBuffer / 2, gravityActive: false };
      currentX += width + selectionBuffer + minSpacing;
      return result;
    });

    currentY += maxHeight + minSpacing;
    return rowItems;
  });

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
