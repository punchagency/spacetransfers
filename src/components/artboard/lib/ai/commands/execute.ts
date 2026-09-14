import type { ArtboardItem } from "../../../types";
import {
  CANVAS,
  CANVAS_BACKGROUNDS,
  ITEM,
  MARGIN_OPTIONS,
  ZOOM,
} from "../../../../../config/artboard.config";
import { computeRenderCopies } from "../../utils/layoutHelpers";
import type {
  BoardCapabilities,
  BoardCommand,
  BoardCommandResult,
  BoardContext,
} from "./types";

/**
 * Applies parsed board commands to the artboard.
 *
 * Everything here is synchronous state math on geometry the app already owns —
 * no network, no model. That is the whole point: a user asking for "4 inches
 * wide, 12 copies" gets it in the same frame they pressed enter.
 *
 * Two invariants the executor is responsible for:
 *  - Nothing may exceed the printable area (sheet width minus both margins),
 *    because a gang sheet that overflows the film is unprintable.
 *  - History is committed exactly once, before the first mutation, so one undo
 *    reverts the whole instruction rather than half of it.
 */

const inch = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded}″`;
};

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** Explicit degrees → the 90° steps the item model actually supports. */
const toQuarterTurns = (degrees: number): number => {
  const steps = Math.round(degrees / 90);
  return ((steps % 4) + 4) % 4;
};

/**
 * Rotates an item by whole quarter turns, swapping the footprint on each step
 * exactly as `rotateSelected` does — the bounding box must always match the
 * rendered orientation or resize handles and DPI math drift apart.
 */
const rotateItem = (item: ArtboardItem, turns: number): ArtboardItem => {
  if (turns === 0) return item;
  const swaps = turns % 2 === 1;
  return {
    ...item,
    rotation: (item.rotation + turns * 90) % 360,
    ...(swaps
      ? {
          widthIn: item.heightIn,
          heightIn: item.widthIn,
          originalWidthIn: item.originalHeightIn,
          originalHeightIn: item.originalWidthIn,
        }
      : {}),
    gravityActive: !item.pinned,
  };
};

/**
 * Marks an item as explicitly placed. `pinned` is what keeps auto-nest from
 * moving it on the next pass. Its columns are kept, so a copy group keeps the
 * shape it was moved as instead of re-wrapping wider over its neighbours.
 */
const pinAt = (item: ArtboardItem, posX: number, posY: number): ArtboardItem => ({
  ...item,
  posX,
  posY,
  pinned: true,
});

export const executeBoardCommands = async (
  commands: BoardCommand[],
  caps: BoardCapabilities,
): Promise<BoardCommandResult> => {
  if (!commands.length) return { ok: false, message: "", changed: false };

  const receipts: string[] = [];
  let changed = false;
  let committed = false;

  /** Commits history lazily so a no-op command leaves the undo stack alone. */
  const commitOnce = () => {
    if (committed) return;
    caps.commitHistory?.();
    committed = true;
  };

  const ctx = (): BoardContext => caps.getContext();

  /** Applies `fn` to every targeted item. Returns how many were touched. */
  const mutate = (fn: (item: ArtboardItem, ctx: BoardContext) => ArtboardItem): number => {
    const context = ctx();
    const ids = new Set(context.targetIds);
    if (ids.size === 0) return 0;
    commitOnce();
    caps.setItems((prev) => prev.map((it) => (ids.has(it.id) ? fn(it, context) : it)));
    changed = true;
    return ids.size;
  };

  const printableWidth = (context: BoardContext) =>
    Math.max(ITEM.MIN_SIZE, context.canvasWidth - 2 * context.marginSize);

  /** Clamps a box to the printable width, preserving aspect. */
  const clampBox = (widthIn: number, heightIn: number, context: BoardContext) => {
    const maxW = printableWidth(context);
    const w = Math.max(ITEM.MIN_SIZE, widthIn);
    const h = Math.max(ITEM.MIN_SIZE, heightIn);
    if (w <= maxW) return { widthIn: w, heightIn: h };
    const ratio = maxW / w;
    return { widthIn: maxW, heightIn: Math.max(ITEM.MIN_SIZE, h * ratio) };
  };

  for (const command of commands) {
    switch (command.kind) {
      case "undo": {
        if (!caps.canUndo) {
          receipts.push("Nothing to undo.");
          break;
        }
        caps.undo();
        receipts.push("Undone.");
        changed = true;
        break;
      }

      case "redo": {
        if (!caps.canRedo) {
          receipts.push("Nothing to redo.");
          break;
        }
        caps.redo();
        receipts.push("Redone.");
        changed = true;
        break;
      }

      case "select": {
        const context = ctx();
        if (command.scope === "all") {
          caps.select(context.items.map((it) => it.id));
          receipts.push(`Selected ${plural(context.items.length, "image")}.`);
        } else {
          caps.select([]);
          receipts.push("Selection cleared.");
        }
        break;
      }

      case "delete": {
        const context = ctx();
        if (command.scope === "all") {
          if (!context.items.length) {
            receipts.push("The board is already empty.");
            break;
          }
          commitOnce();
          const count = context.items.length;
          caps.setItems([]);
          caps.select([]);
          changed = true;
          receipts.push(`Cleared the board — ${plural(count, "image")} removed.`);
          break;
        }
        const ids = new Set(context.targetIds);
        if (!ids.size) {
          receipts.push("Nothing is selected.");
          break;
        }
        commitOnce();
        caps.setItems((prev) => prev.filter((it) => !ids.has(it.id)));
        caps.select([]);
        changed = true;
        receipts.push(`Deleted ${plural(ids.size, "image")}.`);
        break;
      }

      case "resize": {
        const context = ctx();
        const count = mutate((item) => {
          const next =
            command.axis === "width"
              ? {
                  widthIn: command.valueIn,
                  heightIn: item.linked && item.widthIn > 0
                    ? command.valueIn * (item.heightIn / item.widthIn)
                    : item.heightIn,
                }
              : {
                  heightIn: command.valueIn,
                  widthIn: item.linked && item.heightIn > 0
                    ? command.valueIn * (item.widthIn / item.heightIn)
                    : item.widthIn,
                };
          const clamped = clampBox(next.widthIn, next.heightIn, context);
          return { ...item, ...clamped, gravityActive: true };
        });
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        const maxW = printableWidth(context);
        const capped = command.axis === "width" && command.valueIn > maxW;
        receipts.push(
          capped
            ? `${plural(count, "image")} set to ${inch(maxW)} — the widest the film allows after margins.`
            : `${plural(count, "image")} set to ${inch(command.valueIn)} ${command.axis === "width" ? "wide" : "tall"}.`,
        );
        break;
      }

      case "resize-both": {
        const context = ctx();
        const count = mutate((item) => ({
          ...item,
          ...clampBox(command.widthIn, command.heightIn, context),
          gravityActive: true,
        }));
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(
          `${plural(count, "image")} set to ${inch(command.widthIn)} × ${inch(command.heightIn)}.`,
        );
        break;
      }

      case "scale": {
        const context = ctx();
        const count = mutate((item) => ({
          ...item,
          ...clampBox(item.widthIn * command.factor, item.heightIn * command.factor, context),
          gravityActive: true,
        }));
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(`Scaled ${plural(count, "image")} to ${Math.round(command.factor * 100)}%.`);
        break;
      }

      case "fit-width": {
        const context = ctx();
        const maxW = printableWidth(context);
        const count = mutate((item) => {
          const ratio = item.widthIn > 0 ? item.heightIn / item.widthIn : 1;
          return {
            ...item,
            widthIn: maxW,
            heightIn: Math.max(ITEM.MIN_SIZE, maxW * ratio),
            gravityActive: true,
          };
        });
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(`${plural(count, "image")} stretched to ${inch(maxW)} — full printable width.`);
        break;
      }

      case "copies":
      case "copies-delta": {
        const context = ctx();
        if (!context.targetIds.length) {
          receipts.push("Select an image first.");
          break;
        }
        let applied = 0;
        let limited = false;
        const ids = new Set(context.targetIds);
        commitOnce();
        caps.setItems((prev) =>
          prev.map((it) => {
            if (!ids.has(it.id)) return it;
            const requested =
              command.kind === "copies" ? command.value : it.copies + command.delta;
            const wanted = Math.max(1, Math.floor(requested));
            // The layout engine knows how many actually fit across the film;
            // asking for more than that would render copies off the sheet.
            const maxFit = computeRenderCopies(
              { ...it, copies: wanted },
              context.canvasWidth,
              context.marginSize,
              context.spacing,
            );
            const value = Math.min(wanted, maxFit);
            if (value !== wanted) limited = true;
            applied = value;
            return { ...it, copies: value, gravityActive: true, skipAnimation: true };
          }),
        );
        changed = true;
        receipts.push(
          limited
            ? `Set to ${plural(applied, "copy", "copies")} — the most that fit across the sheet.`
            : `Now ${plural(applied, "copy", "copies")}.`,
        );
        break;
      }

      case "duplicate": {
        const context = ctx();
        const targets = context.items.filter((it) => context.targetIds.includes(it.id));
        if (!targets.length) {
          receipts.push("Select an image first.");
          break;
        }
        // Safety ceiling only — whether artwork actually fits is decided by
        // the packer against the sheet's length.
        const room = CANVAS.MAX_ITEMS - context.items.length;
        if (room <= 0) {
          receipts.push(
            `Sheet is full — remove artwork first.`,
          );
          break;
        }
        const wanted = targets.length * command.times;
        const made = Math.min(wanted, room);
        commitOnce();
        const created: ArtboardItem[] = [];
        let seq = Date.now();
        outer: for (let round = 0; round < command.times; round++) {
          for (const target of targets) {
            if (created.length >= made) break outer;
            const offset = ITEM.DUPLICATE_OFFSET * (round + 1);
            created.push({
              ...target,
              id: seq++,
              posX: target.posX + offset,
              posY: target.posY + offset,
              gravityActive: true,
            });
          }
        }
        caps.setItems((prev) => [...prev, ...created]);
        caps.select(created.map((it) => it.id));
        changed = true;
        receipts.push(
          made < wanted
            ? `Added ${plural(made, "duplicate")} — item limit reached.`
            : `Added ${plural(made, "duplicate")}.`,
        );
        break;
      }

      case "rotate": {
        const turns = toQuarterTurns(command.degrees);
        if (turns === 0) {
          receipts.push("That rotation lands back where it started.");
          break;
        }
        const count = mutate((item) => rotateItem(item, turns));
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(`Rotated ${plural(count, "image")} by ${turns * 90}°.`);
        break;
      }

      case "flip": {
        const count = mutate((item) => ({ ...item, flipped: !item.flipped }));
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(`Flipped ${plural(count, "image")}.`);
        break;
      }

      case "lock": {
        const count = mutate((item) => ({ ...item, locked: command.value }));
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(`${plural(count, "image")} ${command.value ? "locked" : "unlocked"}.`);
        break;
      }

      case "auto-crop": {
        if (!caps.toggleAutoCrop) {
          receipts.push("Auto-crop isn't available here.");
          break;
        }
        const context = ctx();
        if (!context.targetIds.length) {
          receipts.push("Select an image first.");
          break;
        }
        commitOnce();
        await caps.toggleAutoCrop(command.value);
        changed = true;
        receipts.push(command.value ? "Trimmed to the artwork." : "Restored the full frame.");
        break;
      }

      case "align": {
        const context = ctx();
        // Aligned against the printable sheet area rather than the selection's
        // bounding box: on a gang sheet each item is an independent print, so
        // "align left" means "against the film's left margin".
        const left = context.marginSize;
        const right = context.canvasWidth - context.marginSize;
        // The sheet grows downward without a fixed height, so vertical alignment
        // is relative to the tallest extent currently in use rather than to a
        // sheet bottom that doesn't exist.
        const extent = context.items.reduce((max, it) => Math.max(max, it.posY + it.heightIn), 0);
        const centreX = (item: ArtboardItem) =>
          Math.max(left, (context.canvasWidth - item.widthIn) / 2);
        const centreY = (item: ArtboardItem) => Math.max(0, (extent - item.heightIn) / 2);

        const count = mutate((item) => {
          switch (command.edge) {
            case "left":
              return pinAt(item, left, item.posY);
            case "right":
              return pinAt(item, Math.max(left, right - item.widthIn), item.posY);
            case "center-x":
              return pinAt(item, centreX(item), item.posY);
            case "top":
              return pinAt(item, item.posX, context.marginSize);
            case "bottom":
              return pinAt(item, item.posX, Math.max(0, extent - item.heightIn));
            case "center-y":
              return pinAt(item, item.posX, centreY(item));
            case "center":
              return pinAt(item, centreX(item), centreY(item));
            default:
              return item;
          }
        });
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(
          command.edge === "center"
            ? `Centred ${plural(count, "image")} on the sheet.`
            : `Aligned ${plural(count, "image")} ${command.edge
                .replace("center-x", "horizontally")
                .replace("center-y", "vertically")}.`,
        );
        break;
      }

      case "nudge": {
        const context = ctx();
        const count = mutate((item) =>
          pinAt(
            item,
            Math.min(
              Math.max(0, item.posX + command.dxIn),
              Math.max(0, context.canvasWidth - item.widthIn),
            ),
            Math.max(0, item.posY + command.dyIn),
          ),
        );
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        const parts: string[] = [];
        if (command.dxIn) parts.push(`${inch(Math.abs(command.dxIn))} ${command.dxIn < 0 ? "left" : "right"}`);
        if (command.dyIn) parts.push(`${inch(Math.abs(command.dyIn))} ${command.dyIn < 0 ? "up" : "down"}`);
        receipts.push(`Moved ${parts.join(" and ")}.`);
        break;
      }

      case "position": {
        const context = ctx();
        const count = mutate((item) =>
          pinAt(
            item,
            command.xIn != null
              ? Math.min(Math.max(0, command.xIn), Math.max(0, context.canvasWidth - item.widthIn))
              : item.posX,
            command.yIn != null ? Math.max(0, command.yIn) : item.posY,
          ),
        );
        if (!count) {
          receipts.push("Select an image first.");
          break;
        }
        receipts.push(`Placed at ${inch(command.xIn ?? 0)}, ${inch(command.yIn ?? 0)}.`);
        break;
      }

      case "distribute": {
        const context = ctx();
        const targets = context.items
          .filter((it) => context.targetIds.includes(it.id))
          .sort((a, b) => (command.axis === "x" ? a.posX - b.posX : a.posY - b.posY));
        if (targets.length < 3) {
          receipts.push("Select at least three images to distribute.");
          break;
        }
        commitOnce();
        const first = targets[0];
        const last = targets[targets.length - 1];
        const startEdge = command.axis === "x" ? first.posX : first.posY;
        const endEdge =
          command.axis === "x" ? last.posX + last.widthIn : last.posY + last.heightIn;
        const totalSize = targets.reduce(
          (sum, it) => sum + (command.axis === "x" ? it.widthIn : it.heightIn),
          0,
        );
        const gap = (endEdge - startEdge - totalSize) / (targets.length - 1);
        const placement = new Map<number, number>();
        let cursor = startEdge;
        for (const item of targets) {
          placement.set(item.id, cursor);
          cursor += (command.axis === "x" ? item.widthIn : item.heightIn) + gap;
        }
        caps.setItems((prev) =>
          prev.map((it) => {
            const at = placement.get(it.id);
            if (at == null) return it;
            return command.axis === "x" ? pinAt(it, at, it.posY) : pinAt(it, it.posX, at);
          }),
        );
        changed = true;
        receipts.push(
          `Spaced ${plural(targets.length, "image")} evenly with ${inch(Math.max(0, gap))} between them.`,
        );
        break;
      }

      case "setting": {
        if (!caps.updateSetting) {
          receipts.push("That board setting isn't adjustable from here.");
          break;
        }
        // The sidebar's margin control is a fixed <select>. Writing a value it
        // has no option for leaves the control blank, so the sidebar would stop
        // reflecting reality — snap to the nearest offered value and say so.
        if (command.key === "marginSize" && typeof command.value === "number") {
          const requested = command.value;
          const snapped = MARGIN_OPTIONS.reduce((best, option) =>
            Math.abs(option - requested) < Math.abs(best - requested) ? option : best,
          );
          caps.updateSetting("marginSize", snapped);
          changed = true;
          receipts.push(
            Math.abs(snapped - requested) < 1e-6
              ? `Sheet margin set to ${inch(snapped)}.`
              : `Sheet margin set to ${inch(snapped)} — the closest option to ${inch(requested)}.`,
          );
          break;
        }
        caps.updateSetting(command.key, command.value);
        changed = true;
        receipts.push(SETTING_RECEIPT[command.key](command.value));
        break;
      }

      case "zoom": {
        if (!caps.setZoom) {
          receipts.push("Zoom isn't adjustable from here.");
          break;
        }
        if (command.mode === "fit") {
          const applied = caps.setZoom(null);
          changed = true;
          receipts.push(`Zoomed to fit — ${Math.round(applied * 100)}%.`);
          break;
        }
        const context = ctx();
        const current = context.zoom ?? 1;
        const target =
          command.mode === "set"
            ? command.factor ?? 1
            : command.mode === "in"
              ? current + ZOOM.STEP * 2
              : current - ZOOM.STEP * 2;
        const applied = caps.setZoom(target);
        changed = true;
        receipts.push(
          Math.abs(applied - target) > 1e-6
            ? `Zoom set to ${Math.round(applied * 100)}% — the limit for this view.`
            : `Zoom set to ${Math.round(applied * 100)}%.`,
        );
        break;
      }
    }
  }

  caps.notifyAction?.({
    type: "aiBoardCommand",
    payload: { commands, changed },
  });

  return {
    ok: true,
    message: receipts.join(" ") || "Done.",
    changed,
  };
};

const onOff = (value: unknown) => (value ? "on" : "off");

const SETTING_RECEIPT: Record<string, (value: any) => string> = {
  autoNestStickers: (v) => `Auto-nest ${onOff(v)}.`,
  spacing: (v) => `Item spacing set to ${inch(v)}.`,
  marginSize: (v) => `Sheet margin set to ${inch(v)}.`,
  showGrid: (v) => `Grid ${onOff(v)}.`,
  showRulers: (v) => `Rulers ${onOff(v)}.`,
  showMargins: (v) => `Margin guides ${onOff(v)}.`,
  snapToGrid: (v) => `Snap to grid ${onOff(v)}.`,
  // Named as the sidebar labels it — "#4b5563" tells the user nothing about
  // which swatch is now highlighted.
  canvasBg: (v) => {
    const swatch = CANVAS_BACKGROUNDS.find((s) => s.id === v);
    return `Canvas background set to ${swatch ? swatch.label : v}.`;
  },
};
