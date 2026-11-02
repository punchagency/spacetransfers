/**
 * Moving and resizing artwork from the keyboard, for anyone who can't drag.
 * Arrow keys move the selection a tenth of an inch, an inch with Shift; plus
 * and minus make it 5% larger or smaller.
 */

export type NudgeAction =
  | { kind: "move"; axis: "posX" | "posY"; by: number }
  | { kind: "resize"; factor: number };

export const nudgeFor = (key: string, shift: boolean): NudgeAction | null => {
  const step = shift ? 1 : 0.1;
  switch (key) {
    case "ArrowLeft":
      return { kind: "move", axis: "posX", by: -step };
    case "ArrowRight":
      return { kind: "move", axis: "posX", by: step };
    case "ArrowUp":
      return { kind: "move", axis: "posY", by: -step };
    case "ArrowDown":
      return { kind: "move", axis: "posY", by: step };
    case "+":
    case "=":
      return { kind: "resize", factor: 1.05 };
    case "-":
    case "_":
      return { kind: "resize", factor: 1 / 1.05 };
    default:
      return null;
  }
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Where a nudge lands. With the grid on, a step smaller than the grid moves to
 * the next grid line, since snapping would otherwise put it straight back.
 */
export const nudgedPosition = (current: number, by: number, gridStepIn: number | null): number => {
  if (!gridStepIn || Math.abs(by) >= gridStepIn) return round2(current + by);
  const lines = current / gridStepIn;
  const next = by > 0 ? Math.floor(lines + 1e-6) + 1 : Math.ceil(lines - 1e-6) - 1;
  return round2(next * gridStepIn);
};

/** The new size, kept between a quarter of an inch and the printable width. */
export const resizedWidth = (widthIn: number, factor: number, maxWidthIn: number) =>
  round2(Math.min(maxWidthIn, Math.max(0.25, widthIn * factor)));

/** What a screen reader hears about a piece of artwork. */
export const describeArtwork = (item: { name?: string; widthIn: number; heightIn: number; copies?: number; locked?: boolean }) =>
  `${item.name || "Image"}, ${item.widthIn.toFixed(2)} by ${item.heightIn.toFixed(2)} inches` +
  (item.copies && item.copies > 1 ? `, ${item.copies} copies` : "") +
  (item.locked ? ", locked" : "");
