import { CANVAS, CANVAS_BACKGROUNDS, MARGIN_OPTIONS } from "../../config/artboard.config";

export interface EditorSettings {
  showGrid: boolean;
  showRulers: boolean;
  showMargins: boolean;
  snapToGrid: boolean;
  autoNestStickers: boolean;
  spacing: number;
  marginSize: number;
  canvasBg: string;
  /** Whether new uploads are cropped to their artwork. Existing pieces are untouched. */
  autoCropUploads: boolean;
  /**
   * Whether the background remover also clears plain background the artwork
   * encloses: the insides of letters, gaps between lines.
   */
  bgClearEnclosed: boolean;
}

export type SheetSettings = Pick<EditorSettings, "spacing" | "marginSize" | "autoNestStickers">;
type ViewSettings = Omit<EditorSettings, keyof SheetSettings>;

const STORAGE_KEY = "editorViewSettings";
const RETIRED_KEYS = ["editorSettings", "canvasBg"];

/** What every new sheet starts with. */
export const DEFAULT_SHEET_SETTINGS: SheetSettings = {
  // Comfortable cutting clearance, without the extra half inch of billed length
  // per row that 0.5in cost.
  spacing: 0.25,
  marginSize: CANVAS.DEFAULT_MARGIN,
  autoNestStickers: true,
};

const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  // Off: the grid is a placement aid, and on a fresh sheet it is noise.
  showGrid: false,
  showRulers: true,
  showMargins: false,
  snapToGrid: false,
  // The background the sidebar shows as unselected-but-default.
  canvasBg: "#f3f4f6",
  autoCropUploads: true,
  bgClearEnclosed: true,
};

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  ...DEFAULT_VIEW_SETTINGS,
  ...DEFAULT_SHEET_SETTINGS,
};

/** Widest sensible gap between items, so a stored value cannot blow up a layout. */
const MAX_SPACING_IN = 6;

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

const spacingOr = (v: unknown, fallback: number) => {
  // `Number(null)` is 0, which would pass as a real spacing.
  if (typeof v !== "number") return fallback;
  return Number.isFinite(v) && v >= 0 && v <= MAX_SPACING_IN ? v : fallback;
};

/*
 * Margin has to be one of the offered options. Anything else cannot be shown by
 * the select — which is the bug that made the running 0.15in default invisible
 * in a list of 0.25, 0.5 and 1.0.
 */
const marginOr = (v: unknown, fallback: number) =>
  typeof v === "number" && (MARGIN_OPTIONS as readonly number[]).includes(v) ? v : fallback;

const canvasBgOr = (v: unknown, fallback: string) =>
  typeof v === "string" && CANVAS_BACKGROUNDS.some((s) => s.id === v) ? v : fallback;

export const loadEditorSettings = (): EditorSettings => {
  let stored: any = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    // Unreadable or not JSON — the defaults stand.
    stored = null;
  }

  const v = DEFAULT_VIEW_SETTINGS;
  const view: ViewSettings =
    stored && typeof stored === "object"
      ? {
          showGrid: bool(stored.showGrid, v.showGrid),
          showRulers: bool(stored.showRulers, v.showRulers),
          showMargins: bool(stored.showMargins, v.showMargins),
          snapToGrid: bool(stored.snapToGrid, v.snapToGrid),
          canvasBg: canvasBgOr(stored.canvasBg, v.canvasBg),
          autoCropUploads: bool(stored.autoCropUploads, v.autoCropUploads),
          bgClearEnclosed: bool(stored.bgClearEnclosed, v.bgClearEnclosed),
        }
      : { ...v };

  // Sheet settings are never read from the browser, including any an earlier
  // version wrote there — see the note at the top.
  return { ...view, ...DEFAULT_SHEET_SETTINGS };
};

export const saveEditorSettings = (settings: EditorSettings): void => {
  const view: ViewSettings = {
    showGrid: settings.showGrid,
    showRulers: settings.showRulers,
    showMargins: settings.showMargins,
    snapToGrid: settings.snapToGrid,
    canvasBg: settings.canvasBg,
    autoCropUploads: settings.autoCropUploads,
    bgClearEnclosed: settings.bgClearEnclosed,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
    // Never read again; removed so they cannot be mistaken for live settings.
    for (const key of RETIRED_KEYS) localStorage.removeItem(key);
  } catch {
    // Private browsing, or storage full. The session still works; it just will
    // not be remembered, which is better than throwing out of a click handler.
  }
};

export const sheetSettingsFromSaved = (artboardData: unknown): SheetSettings => {
  const d = (artboardData && typeof artboardData === "object" ? artboardData : {}) as Record<string, unknown>;
  const fallback = DEFAULT_SHEET_SETTINGS;
  return {
    spacing: spacingOr(d.itemSpacingIn, fallback.spacing),
    marginSize: marginOr(d.sheetMarginIn, fallback.marginSize),
    autoNestStickers: bool(d.autoNest, fallback.autoNestStickers),
  };
};

/** The sheet settings as a saved design stores them. */
export const sheetSettingsForSave = (settings: EditorSettings) => ({
  itemSpacingIn: settings.spacing,
  sheetMarginIn: settings.marginSize,
  autoNest: settings.autoNestStickers,
});
