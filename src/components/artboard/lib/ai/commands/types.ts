import type { ArtboardItem } from "../../../types";

/**
 * Board commands — the second half of what the AI text box can do.
 *
 * The existing `AiIntentId` pipeline edits *pixels*: it sends an image to a
 * model and swaps in whatever comes back. That covers "remove the background"
 * but nothing a user actually spends most of their time on in a gang sheet —
 * sizing to a physical measurement, setting copy counts, aligning, nesting,
 * clearing the sheet.
 *
 * Those are mechanical operations on geometry the app already owns exactly, so
 * they are parsed deterministically and executed locally: instant, free, offline,
 * and reproducible. This mirrors the reasoning already applied to `classifyPrompt`
 * — keep work the app does well offline off the generative path.
 *
 * A command is data, not a closure, so the same parse can be logged, previewed,
 * replayed, or (later) emitted by a model without touching the executor.
 */
export type BoardCommand =
  // ── Physical size ────────────────────────────────────────────────────────
  /** Set an absolute print dimension in inches. */
  | { kind: "resize"; axis: "width" | "height"; valueIn: number }
  /** Set both dimensions at once ("make it 4 by 6"). */
  | { kind: "resize-both"; widthIn: number; heightIn: number }
  /** Multiply current size ("twice as big", "50%"). */
  | { kind: "scale"; factor: number }
  /** Grow to the full printable width of the sheet, keeping aspect. */
  | { kind: "fit-width" }

  // ── Repetition ───────────────────────────────────────────────────────────
  | { kind: "copies"; value: number }
  | { kind: "copies-delta"; delta: number }
  /** Independent duplicates (separate items), unlike `copies` on one item. */
  | { kind: "duplicate"; times: number }

  // ── Transform ────────────────────────────────────────────────────────────
  /** Clockwise degrees; normalised to 90° steps by the executor. */
  | { kind: "rotate"; degrees: number }
  | { kind: "flip" }
  | { kind: "lock"; value: boolean }
  | { kind: "auto-crop"; value: boolean }

  // ── Placement ────────────────────────────────────────────────────────────
  /** `center` is both axes at once — "center it" is one user action, not two. */
  | { kind: "align"; edge: "left" | "right" | "top" | "bottom" | "center" | "center-x" | "center-y" }
  /** Relative nudge in inches. */
  | { kind: "nudge"; dxIn: number; dyIn: number }
  /** Absolute placement in inches from the sheet origin. */
  | { kind: "position"; xIn?: number; yIn?: number }
  /** Even horizontal gaps across the selection. */
  | { kind: "distribute"; axis: "x" | "y" }

  // ── Sheet ────────────────────────────────────────────────────────────────
  | { kind: "delete"; scope: "selection" | "all" }
  | { kind: "select"; scope: "all" | "none" }
  | { kind: "undo" }
  | { kind: "redo" }

  // ── Board settings (owned by the editor, toggled through a callback) ──────
  | { kind: "setting"; key: BoardSettingKey; value: boolean | number | string }

  // ── View ─────────────────────────────────────────────────────────────────
  /**
   * `fit` returns to the automatic width-fit that the artboard uses by default;
   * a numeric `factor` pins an explicit zoom until fit is requested again.
   */
  | { kind: "zoom"; mode: "fit" | "in" | "out" | "set"; factor?: number };

export type BoardSettingKey =
  | "autoNestStickers"
  | "spacing"
  | "marginSize"
  | "showGrid"
  | "showRulers"
  | "showMargins"
  | "snapToGrid"
  | "canvasBg";

/** Live board state the executor reads at the moment it runs. */
export interface BoardContext {
  items: ArtboardItem[];
  /** Items the command applies to — the selection, or everything when nothing is selected. */
  targetIds: number[];
  /** Full sheet width in inches. */
  canvasWidth: number;
  marginSize: number;
  spacing: number;
  /** Current canvas zoom, so relative "zoom in"/"zoom out" have a basis. */
  zoom?: number;
}

/**
 * Everything the executor is allowed to touch.
 *
 * Passed in rather than imported so the command layer stays testable and has no
 * opinion about where board state lives.
 */
export interface BoardCapabilities {
  getContext: () => BoardContext;
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>;
  /** Called once, immediately before the first mutation, so one undo reverts the whole command. */
  commitHistory?: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Replaces the current selection. */
  select: (ids: number[]) => void;
  /**
   * Delegates to the existing auto-crop action rather than reimplementing it:
   * trimming does real image work (server trim, or a canvas alpha/border scan)
   * and setting the flag alone would claim a crop that never happened.
   */
  toggleAutoCrop?: (value: boolean) => void | Promise<void>;
  /**
   * Sets the canvas zoom. `null` restores the automatic width-fit rather than
   * pinning a number, so the board keeps responding to window resizes.
   * Returns the zoom actually applied, after clamping.
   */
  setZoom?: (factor: number | null) => number;
  /** Editor-owned settings. Absent when the host doesn't expose them. */
  updateSetting?: (key: BoardSettingKey, value: boolean | number | string) => void;
  notifyAction?: (action: { type: string; id?: number; payload?: any }) => void;
}

export interface BoardCommandResult {
  ok: boolean;
  /** Conversational confirmation, e.g. "3 images set to 4″ wide." */
  message: string;
  /** False when the command was understood but changed nothing worth undoing. */
  changed: boolean;
}
