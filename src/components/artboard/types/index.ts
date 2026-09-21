import type { ImageSnapshot } from "../lib/utils/imageState";

export interface ArtboardItem {
  id: number;
  url: string;
  rotation: number;
  locked: boolean;
  expanded: boolean;
  flipped: boolean;
  autoCrop: boolean;
  copies: number;
  widthIn: number;
  heightIn: number;
  posX: number;
  posY: number;
  linked: boolean;
  price: number;
  name?: string;
  isAnimating?: boolean;
  dropY?: number;
  velocityY?: number;
  gravityActive?: boolean;
  skipAnimation?: boolean;
  /** MongoDB ObjectId string from the Asset DB record — preferred over originalUrl for export DPI lookup. */
  assetId?: string;
  /**
   * Authoritative full-resolution export URL — always a Cloudinary URL or a native-resolution
   * canvas PNG data URL (generated at img.naturalWidth × img.naturalHeight, never at CSS size).
   * Kept separate from `url` (the artboard display URL) so the export pipeline is never affected
   * by CSS scaling, preview downscaling, or intermediate compression on the display path.
   */
  croppedUrl?: string;
  /**
   * Pixel width of the croppedUrl source image. Required for canvas-processed items (canvas
   * crop, BG removal) where the data URL's pixel count differs from the DB-stored widthPx /
   * trimmedWidthPx of the original asset. The server uses this to calculate exact native DPI
   * without doing a DB lookup, preventing upscaling in the Sharp compositor.
   */
  croppedWidthPx?: number;
  /** Pixel height of the croppedUrl source — see croppedWidthPx. */
  croppedHeightPx?: number;
  /**
   * Pixel width of whatever image `url` currently points to — kept in sync on
   * every operation that changes the underlying pixels (crop, BG removal, AI
   * upscale), independent of croppedWidthPx (which is only set on the canvas
   * crop path). Lets effective-DPI be recalculated as `nativeWidthPx / widthIn`
   * anywhere in the app (not just inside the mounted ArtboardItem, which can
   * measure it directly from the loaded <img>), so DPI warnings stay correct
   * across resizes without needing a live image element.
   */
  nativeWidthPx?: number;
  /** The upload this piece came from — its identity for saving and checkout. Never changes after an edit. */
  originalUrl?: string;
  originalWidthIn?: number;
  originalHeightIn?: number;
  /**
   * The piece's current image before auto-crop trims it: the upload, or the
   * result of the latest edit. The auto-crop switch works from this, so it never
   * undoes an edit. See `imageState.ts`.
   */
  uncroppedUrl?: string;
  /** Pixel size of `uncroppedUrl`, so the auto-crop toggle keeps a piece's scale both ways. */
  uncroppedWidthPx?: number;
  uncroppedHeightPx?: number;
  isDropping?: boolean;
  dpi?: number;
  // Unified flow geometry — when set, copies render at cells within a shared
  // grid so multiple grouped items can occupy a single fluid layout.
  // flowCols is the total columns of the shared grid; flowStartCol/flowEndCol
  // mark where this item's copies begin (first row) and end (last row).
  flowCols?: number;
  flowStartCol?: number;
  flowEndCol?: number;
  /** When true, the auto-nest layout engine leaves this item at its current position. */
  pinned?: boolean;
  /**
   * Auto-nest rotation applied by the layout engine (0 = original orientation,
   * 90 = rotated 90° clockwise to improve row packing). Set only while
   * autoNestStickers is enabled; cleared to 0 when auto-nest is turned off.
   */
  nestRotation?: 0 | 90;
  /** Pieces sharing a group id are selected, moved, nested, turned and flipped as one. */
  groupId?: string;
  /**
   * Trail of AI edits applied to this item, oldest first (capped at 10). Each
   * entry stores the prompt and the image as it was *before* that edit — its
   * URL, and the size and pixel counts that went with it — so a version-history
   * UI can restore any earlier state. Undo/redo is handled separately by
   * useHistory's item snapshots.
   */
  aiHistory?: Array<{ prompt: string; url: string; at: number; snapshot?: ImageSnapshot }>;
}

/** The selection as the image toolbar sees it. */
export interface SelectionSummary {
  /** Pieces selected. */
  count: number;
  /** Selected pieces that are not locked. */
  editable: number;
  /** Unlocked selected pieces below 300 DPI or with no measurable DPI. */
  lowDpi: number;
}

export interface HistoryState {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export interface ArtboardProps {
  onHeaderInfoChange?: (info: HeaderInfo) => void;
  showRulers?: boolean;
  showGrid?: boolean;
  snapToGrid?: boolean;
  showMargins?: boolean;
  marginSize?: number;
  autoNestStickers?: boolean;
  spacing?: number;
  /** Whether new uploads are auto-cropped — the sidebar's "Auto Crop Uploads". */
  autoCropUploads?: boolean;
  /** False while a dialog owns the screen, so "N" does not re-nest the board behind it. */
  shortcutsEnabled?: boolean;
  onRequestAutoNest?: (enabled: boolean) => void;
  /**
   * Writes a board setting owned by the editor. Supplied so the AI text box can
   * act on "turn auto-nest on" or "set spacing to 0.25in" — every other setting
   * arrives here as a read-only prop, which is enough to render but not to change.
   */
  onUpdateSetting?: (key: string, value: boolean | number | string) => void;
  onDataChange?: (data: any) => void;
  initialData?: any;
  onActionPerformed?: (action: { type: string; id?: number; payload?: any }) => void;
  onHistoryChange?: (state: HistoryState) => void;
  /** Visual-only artboard background. 'transparent' = checkerboard; a hex/named
   *  color or 'rainbow' = solid/gradient fill. Never affects exports. */
  canvasBg?: string;
  /**
   * Marks every item the top-bar DPI chip is counting, so the customer can see
   * which artwork it means. Purely additive chrome — no item's position, size,
   * rotation or content is touched, and the flag is derived from the same
   * `computeEffectiveDpi` the chip's own count comes from.
   */
  highlightLowDpi?: boolean;
}

export interface HeaderInfo {
  hasItem: boolean;
  areaSf?: number;
  widthIn?: number;
  heightIn?: number;
  name?: string;
  price?: number;
  imageNames?: string[];
  lowDpiCount?: number;
  unknownDpiCount?: number;
}
