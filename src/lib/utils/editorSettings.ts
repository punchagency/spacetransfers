import { CANVAS, CANVAS_BACKGROUNDS, MARGIN_OPTIONS } from "../../config/artboard.config";

/**
 * The editor's display and layout preferences, remembered between visits.
 *
 * Only `canvasBg` used to persist. The other seven — grid, rulers, margins,
 * snap, auto-nest, spacing and margin size — were held in component state and
 * reset on every reload, so someone who turned rulers off found them back on
 * next time and reasonably concluded the toggle was broken.
 *
 * Everything is validated on read. These feed layout and, through
 * `marginSize`, the usable width a sheet is priced on — so a corrupted or
 * hand-edited value must fall back to the default rather than reach the canvas.
 */

export interface EditorSettings {
  showGrid: boolean;
  showRulers: boolean;
  showMargins: boolean;
  snapToGrid: boolean;
  autoNestStickers: boolean;
  spacing: number;
  marginSize: number;
  canvasBg: string;
}

const STORAGE_KEY = "editorSettings";

/** The background the sidebar shows as unselected-but-default. */
const DEFAULT_CANVAS_BG = "#f3f4f6";

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  showGrid: true,
  showRulers: true,
  showMargins: false,
  snapToGrid: false,
  autoNestStickers: true,
  // The starting spacing for a new gang sheet; adjustable in the sidebar.
  spacing: 0.5,
  marginSize: CANVAS.DEFAULT_MARGIN,
  canvasBg: DEFAULT_CANVAS_BG,
};

/** Widest sensible gap between items, so a stored value cannot blow up a layout. */
const MAX_SPACING_IN = 6;

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

const spacingOr = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_SPACING_IN ? n : fallback;
};

/*
 * Margin has to be one of the offered options. Anything else cannot be shown by
 * the select — which is the bug that made the running 0.15in default invisible
 * in a list of 0.25, 0.5 and 1.0.
 */
const marginOr = (v: unknown, fallback: number) => {
  const n = Number(v);
  return (MARGIN_OPTIONS as readonly number[]).includes(n) ? n : fallback;
};

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

  /*
   * The previous single-key format, so an existing background choice survives
   * the move rather than snapping back to grey on first load after this ships.
   */
  if (!stored) {
    try {
      const legacy = localStorage.getItem("canvasBg");
      if (legacy) stored = { canvasBg: legacy };
    } catch {
      /* ignore */
    }
  }

  if (!stored || typeof stored !== "object") return { ...DEFAULT_EDITOR_SETTINGS };

  const d = DEFAULT_EDITOR_SETTINGS;
  return {
    showGrid: bool(stored.showGrid, d.showGrid),
    showRulers: bool(stored.showRulers, d.showRulers),
    showMargins: bool(stored.showMargins, d.showMargins),
    snapToGrid: bool(stored.snapToGrid, d.snapToGrid),
    autoNestStickers: bool(stored.autoNestStickers, d.autoNestStickers),
    spacing: spacingOr(stored.spacing, d.spacing),
    marginSize: marginOr(stored.marginSize, d.marginSize),
    canvasBg: canvasBgOr(stored.canvasBg, d.canvasBg),
  };
};

export const saveEditorSettings = (settings: EditorSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // The old key is no longer read once the new one exists; removing it stops
    // the two disagreeing if anything still writes it.
    localStorage.removeItem("canvasBg");
  } catch {
    // Private browsing, or storage full. The session still works; it just will
    // not be remembered, which is better than throwing out of a click handler.
  }
};
