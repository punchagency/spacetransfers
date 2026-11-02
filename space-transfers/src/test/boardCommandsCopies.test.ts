import { describe, expect, it } from "vitest";
import { executeBoardCommands } from "../components/artboard/lib/ai/commands/execute";
import type { BoardCapabilities } from "../components/artboard/lib/ai/commands/types";
import type { ArtboardItem } from "../components/artboard/types";

/**
 * React runs a state updater later than the line that queues it. The copies
 * command worked out its reply inside the updater, so the reply was written
 * before the count existed and read "Now 0 copies." after every change. These
 * capabilities defer updaters the same way, to keep that class of bug caught.
 */
const piece = (over: Partial<ArtboardItem> = {}): ArtboardItem => ({
  id: 1, url: "x", rotation: 0, locked: false, expanded: false, flipped: false, autoCrop: false,
  copies: 1, widthIn: 2, heightIn: 2, posX: 0.25, posY: 0.25, linked: true, price: 0, ...over,
});

const board = (items: ArtboardItem[]) => {
  let state = items;
  const queued: Array<(prev: ArtboardItem[]) => ArtboardItem[]> = [];
  const caps: BoardCapabilities = {
    getContext: () => ({ items: state, targetIds: [1], canvasWidth: 22, marginSize: 0.25, spacing: 0.25 }),
    setItems: ((u: any) => queued.push(typeof u === "function" ? u : () => u)) as any,
    undo: () => {}, redo: () => {}, canUndo: false, canRedo: false, select: () => {},
  };
  const flush = () => { while (queued.length) state = queued.shift()!(state); return state; };
  return { caps, flush };
};

describe("copies command", () => {
  it("reports the count it set", async () => {
    const { caps, flush } = board([piece()]);
    const result = await executeBoardCommands([{ kind: "copies", value: 3 } as any], caps);
    expect(result.message).toBe("Now 3 copies.");
    expect(flush()[0].copies).toBe(3);
  });

  it("leaves a locked piece alone and says so", async () => {
    const { caps, flush } = board([piece({ locked: true })]);
    const result = await executeBoardCommands([{ kind: "copies", value: 5 } as any], caps);
    expect(result.message).toMatch(/locked/i);
    expect(flush()[0].copies).toBe(1);
  });
});
