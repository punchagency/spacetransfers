export const getGangsheetSnapshot = (items: any[]): string => {
  if (!Array.isArray(items)) return "[]";

  return JSON.stringify(
    items.map((it: any) => ({
      assetId: it.originalUrl || it.assetId || it.url,
      url: typeof it.url === "string" ? it.url : null,
      widthIn: Math.round((it.widthIn || 0) * 1000) / 1000,
      heightIn: Math.round((it.heightIn || 0) * 1000) / 1000,
      posX: Math.round((it.posX || 0) * 1000) / 1000,
      posY: Math.round((it.posY || 0) * 1000) / 1000,
      rotation: it.rotation || 0,
      copies: it.copies || 1,
      linked: Boolean(it.linked),
      autoCrop: it.autoCrop !== false,
      flipped: Boolean(it.flipped),
      locked: Boolean(it.locked),
      expanded: Boolean(it.expanded),
    })),
  );
};

