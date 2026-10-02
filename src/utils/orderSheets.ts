/**
 * The gang sheets on an order, and which one a request means.
 *
 * An order can hold several sheets — the cart sells them together — but the
 * printer's preview and print export, and the admin's contents and preview,
 * each took `items.find(type === "gangsheet")`: the first sheet only. On a
 * two-sheet order the second was never shown, never exported, and so never
 * printed, though the customer paid for it. Every sheet-level endpoint now
 * takes a `sheet` index (0-based, default 0) and reports the full list.
 */

type AnyItem = Record<string, any>;

/** The order's printable sheets, in order. */
export const orderSheets = (items: unknown): AnyItem[] => {
  const list = Array.isArray(items) ? (items as AnyItem[]) : [];
  const sheets = list.filter((it) => it && (it.type === "gangsheet" || Array.isArray(it.artboardItems)));
  // An order from before items were typed: its first item was the sheet.
  return sheets.length > 0 ? sheets : list.slice(0, 1);
};

const badRequest = (message: string) => {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
};

/**
 * The sheet a request asks for. No `sheet` means the first, as before, so
 * existing callers keep working; an index the order doesn't have is refused
 * rather than silently swapped for another sheet.
 */
export const pickOrderSheet = (items: unknown, raw: unknown): { sheet: AnyItem; index: number; count: number } => {
  const sheets = orderSheets(items);
  if (raw === undefined || raw === null || raw === "") {
    return { sheet: sheets[0] || {}, index: 0, count: sheets.length };
  }
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index >= sheets.length) {
    throw badRequest(`This order has ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}; sheet ${String(raw)} isn't one of them.`);
  }
  return { sheet: sheets[index], index, count: sheets.length };
};

export interface SheetSummary {
  index: number;
  name: string;
  widthIn: number | null;
  heightIn: number | null;
  /** How many of this sheet to print. */
  quantity: number;
  /** Graphics placed on it. */
  itemCount: number;
  previewImage: string | null;
}

/** One line per sheet, for lists and switchers. `resolve` turns a stored preview path into a URL. */
export const sheetSummaries = (items: unknown, resolve: (v: unknown) => string | null = (v) => (typeof v === "string" && v ? v : null)): SheetSummary[] =>
  orderSheets(items).map((it, index) => ({
    index,
    name: String(it.name || `Sheet ${index + 1}`),
    widthIn: typeof (it.sheetWidthIn ?? it.widthIn) === "number" ? Number(it.sheetWidthIn ?? it.widthIn) : null,
    heightIn: typeof (it.sheetHeightIn ?? it.heightIn) === "number" ? Number(it.sheetHeightIn ?? it.heightIn) : null,
    quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
    itemCount: Array.isArray(it.artboardItems) ? it.artboardItems.length : 0,
    previewImage: resolve(it.previewImage),
  }));

/**
 * The graphics on one sheet as the admin's "Gangsheet Contents" lists them —
 * the same row shape the order page already rendered for the first sheet.
 */
export const sheetContents = (artboardItems: unknown, names?: Map<string, string>) =>
  (Array.isArray(artboardItems) ? artboardItems : []).map((it: any) => {
    const rawSku = typeof it.assetId === "string" ? it.assetId : "";
    const sku = rawSku ? rawSku.split("/").filter(Boolean).slice(-1)[0] : `ITEM-${it.id}`;
    const baseName = sku ? sku.replace(/\.[a-z0-9]+$/i, "") : `Artwork ${it.id}`;
    // The file's own name when known ("logo-on-white.jpg"), not its database id.
    const uploaded = rawSku ? names?.get(rawSku) : undefined;
    return {
      name: uploaded || baseName || `Artwork ${it.id}`,
      sku,
      quantity: typeof it.copies === "number" ? it.copies : 1,
      size:
        typeof it.widthIn === "number" && typeof it.heightIn === "number"
          ? `${it.widthIn.toFixed(2)}" × ${it.heightIn.toFixed(2)}"`
          : "N/A",
      color: "N/A",
      customAttributes: {
        linked: Boolean(it.linked),
        autoCrop: it.autoCrop !== false,
        rotation: typeof it.rotation === "number" ? it.rotation : 0,
      },
      fileUrl: it.croppedUrl || it.assetId || null,
    };
  });
