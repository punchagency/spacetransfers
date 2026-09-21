import { CANVAS, DPI, MAX_SHEET_HEIGHT_IN } from "../../../../config/artboard.config";

/** Vertical gap between stacked copies of one item. */
const SHEET_GROUP_GAP_IN = CANVAS.GRID_GAP_IN;

/**
 * Returns how many copies of an item can physically fit within the 1200" sheet
 * height limit, capped at whatever the user requested.
 */
export function computeRenderCopies(
  item: { widthIn: number; heightIn: number; copies: number },
  canvasWidthIn: number,
  marginIn: number,
  spacingIn: number
): number {
  const effectiveMargin = Math.max(0, marginIn);
  const gap = spacingIn;
  const maxAvailableWidth = Math.max(0, canvasWidthIn - 2 * effectiveMargin);
  const scaledWidth = Math.max(1e-6, item.widthIn);
  const scaledHeight = Math.max(1e-6, item.heightIn);

  const capacityCols = Math.max(
    1,
    Math.floor((maxAvailableWidth + gap) / (scaledWidth + gap))
  );
  const maxGroupHeightAllowedIn = Math.max(0, MAX_SHEET_HEIGHT_IN - effectiveMargin);
  const maxRows = Math.max(
    1,
    Math.floor((maxGroupHeightAllowedIn + gap) / (scaledHeight + gap))
  );
  const visibleColsCandidate = Math.max(1, Math.min(item.copies, capacityCols));
  const maxCopiesThatFit = Math.max(1, maxRows * visibleColsCandidate);
  return Math.max(1, Math.min(item.copies, maxCopiesThatFit));
}

/**
 * Effective print DPI for the item's CURRENT display size — recalculates on
 * every resize rather than trusting the (possibly stale) stored `dpi` field.
 * Prefers actual pixel width (croppedWidthPx, then nativeWidthPx — both kept
 * in sync whenever the underlying image pixels change: crop, BG removal, AI
 * upscale) since that's correct regardless of how many times widthIn has
 * changed since upload. Only falls back to the stored `dpi` snapshot for
 * items that predate these fields (e.g. designs saved before this existed).
 */
/** Vertical span an item occupies on the sheet, in inches. */
export interface VerticalExtent {
  topIn: number;
  bottomIn: number;
}

/**
 * The vertical band an item's rendered copy-grid occupies.
 *
 * Exists for viewport culling: `CanvasContainer` mounts only the items whose
 * band intersects the visible scroll range, so a sheet with thousands of
 * placements costs the same to render as one with a screenful.
 *
 * The maths deliberately mirrors `ArtboardItem`'s own layout (nest-rotation
 * swap, flow columns, row count, the 1200" clamp) rather than approximating it.
 * A cull decision that disagrees with what the item actually renders makes
 * artwork vanish mid-scroll, which is far worse than rendering a few extra
 * items — so where the two could drift, this errs toward a taller band.
 */
export function getItemVerticalExtent(
  item: {
    widthIn: number;
    heightIn: number;
    posY: number;
    copies: number;
    nestRotation?: number;
    flowCols?: number;
    flowStartCol?: number;
    flowEndCol?: number;
  },
  canvasWidthIn: number,
  marginIn: number,
  spacingIn: number,
): VerticalExtent {
  const effectiveMargin = Math.max(0, marginIn);
  const gap = spacingIn;
  const maxAvailableWidth = canvasWidthIn - 2 * effectiveMargin;

  const nestRot = item.nestRotation ?? 0;
  const scaledWidth = nestRot === 90 ? item.heightIn : item.widthIn;
  const scaledHeight = nestRot === 90 ? item.widthIn : item.heightIn;

  const renderCopies = computeRenderCopies(
    { widthIn: scaledWidth, heightIn: scaledHeight, copies: item.copies },
    canvasWidthIn,
    effectiveMargin,
    gap,
  );

  const hasFlow =
    typeof item.flowCols === "number" &&
    typeof item.flowStartCol === "number" &&
    typeof item.flowEndCol === "number";
  // Same column rule as the footprint, the renderer and the print export.
  const flowCols = hasFlow
    ? Math.max(1, item.flowCols!)
    : computeGroupDims(scaledWidth, scaledHeight, Math.max(1, renderCopies), Math.max(1e-6, maxAvailableWidth), gap).cols;
  const flowStartCol = hasFlow ? Math.max(0, item.flowStartCol!) : 0;

  const rows = (() => {
    if (renderCopies <= 0) return 1;
    const firstRowCapacity = Math.max(1, flowCols - flowStartCol);
    if (renderCopies <= firstRowCapacity) return 1;
    return 1 + Math.ceil((renderCopies - firstRowCapacity) / flowCols);
  })();

  const groupHeightInches = rows * scaledHeight + (rows - 1) * gap;
  const topIn = Math.min(item.posY, MAX_SHEET_HEIGHT_IN - groupHeightInches);

  return { topIn, bottomIn: topIn + groupHeightInches };
}

export function computeEffectiveDpi(item: {
  dpi?: number;
  widthIn: number;
  heightIn?: number;
  rotation?: number;
  croppedWidthPx?: number;
  nativeWidthPx?: number;
}): number | null {
  const pixelWidth = item.croppedWidthPx || item.nativeWidthPx;
  // Every 90° rotation swaps widthIn/heightIn (see rotateSelected), but the
  // stored pixel width always describes the image's own width axis. At odd
  // rotations that axis is displayed along heightIn, so divide by that —
  // otherwise a rotated non-square image reports a bogus DPI (the source of
  // the false low-DPI warnings after rotation).
  const rotationOdd = ((Math.round((item.rotation ?? 0) / 90) % 2) + 2) % 2 === 1;
  const widthAxisIn = rotationOdd && typeof item.heightIn === "number" ? item.heightIn : item.widthIn;
  if (pixelWidth && widthAxisIn > 0) {
    return Math.round(pixelWidth / widthAxisIn);
  }
  return typeof item.dpi === "number" ? item.dpi : null;
}

/** The shape the DPI predicates need — a subset of `ArtboardItem`. */
export type DpiMeasurable = Parameters<typeof computeEffectiveDpi>[0];

/**
 * The three DPI verdicts, in one place.
 *
 * The top-bar chip's count, the tooltip's breakdown and the on-sheet highlight
 * all have to agree about which artwork is flagged — a chip reading "5" that
 * lights up four images is worse than no highlight at all. They previously
 * agreed by having the same expression written out at each call site, which is
 * an agreement that lasts exactly until someone edits one of them.
 *
 * `null` from `computeEffectiveDpi` means *unmeasurable*, not zero: the item's
 * pixel dimensions aren't known yet (or were never recorded). That is a
 * different problem from artwork that is measurably soft, so the two are
 * counted separately — but both are "needs a look", which is what
 * `isDpiFlagged` covers and what the chip totals.
 */
export const isLowDpi = (item: DpiMeasurable): boolean => {
  const dpi = computeEffectiveDpi(item);
  return dpi !== null && dpi < DPI.THRESHOLD;
};

export const isUnknownDpi = (item: DpiMeasurable): boolean =>
  computeEffectiveDpi(item) === null;

/** Either verdict — i.e. exactly what the chip counts and the highlight marks. */
export const isDpiFlagged = (item: DpiMeasurable): boolean => {
  const dpi = computeEffectiveDpi(item);
  return dpi === null || dpi < DPI.THRESHOLD;
};

export interface LayoutItem {
  id: number;
  widthIn: number;
  heightIn: number;
  posX: number;
  posY: number;
  gravityActive?: boolean;
  copies?: number;
  flowCols?: number;
  flowStartCol?: number;
  flowEndCol?: number;
  pinned?: boolean;
  locked?: boolean;
  nestRotation?: 0 | 90;
  /** Pieces sharing a group id move, nest and turn as one. */
  groupId?: string;
  /** A collapsed group standing in for its members during layout: never turned by the packer. */
  rigid?: boolean;
}

export const getRenderedGroupSize = (
  widthIn: number,
  heightIn: number,
  copies: number = 1,
  maxAvailableWidthIn: number,
  gapIn: number = CANVAS.GRID_GAP_IN
) => {
  const w = Math.max(0, Number(widthIn || 0));
  const h = Math.max(0, Number(heightIn || 0));
  const c = Math.max(1, Number(copies || 1));

  if (c <= 1) return { width: w, height: h, cols: 1, rows: 1 };

  const capacityCols = Math.max(
    1,
    Math.floor((maxAvailableWidthIn + gapIn) / Math.max(1e-6, w + gapIn))
  );
  const cols = Math.max(1, Math.min(c, capacityCols));
  const rows = Math.max(1, Math.ceil(c / capacityCols));

  const widthRaw = cols * w + (cols - 1) * gapIn;
  const width = Math.min(widthRaw, Math.max(0, maxAvailableWidthIn));
  const height = rows * h + (rows - 1) * gapIn;

  return { width, height, cols, rows };
};

export const getRenderedBounds = (
  item: LayoutItem,
  canvasWidthIn: number,
  marginIn: number
) => {
  const effectiveMargin = Math.max(0, Number(marginIn || 0));
  const maxAvailableWidth = Math.max(0, canvasWidthIn - 2 * effectiveMargin);
  const copies = typeof item.copies === "number" && item.copies > 0 ? item.copies : 1;
  // Use effective dimensions (post nest-rotation) for bounds calculation.
  const w = item.nestRotation === 90 ? item.heightIn : item.widthIn;
  const h = item.nestRotation === 90 ? item.widthIn : item.heightIn;
  const group = getRenderedGroupSize(w, h, copies, maxAvailableWidth);

  const centeredLeft = effectiveMargin + (maxAvailableWidth - group.width) / 2;
  const rightBoundLeft = canvasWidthIn - effectiveMargin - group.width;
  const left =
    copies > 1
      ? Math.max(effectiveMargin, Math.min(centeredLeft, rightBoundLeft))
      : Math.max(effectiveMargin, item.posX);

  const bottomLimitTop = MAX_SHEET_HEIGHT_IN - group.height;
  const top = Math.min(item.posY, bottomLimitTop);

  return {
    left,
    top,
    right: left + group.width,
    bottom: top + group.height,
    width: group.width,
    height: group.height,
  };
};

// ── Free-Rectangle Bin-Packing Engine ─────────────────────────────────────
// This is the ONE layout engine for the artboard: every add, duplicate,
// delete, resize, rotate, or copy-count change triggers a full rebuild of
// every unpinned/unlocked item from scratch (see useArtboardEffects). It
// replaces the earlier shelf-packing, free-rect "gravity lane", and row/lane
// based implementations that used to live here.
//
// Algorithm (classic MaxRects, extended with an explicit merge pass):
//   1. Start with one free rectangle covering the full usable print area.
//   2. Pinned/locked items are stamped into the free-space list first (at
//      their current position) so packable items are placed around them,
//      never on top — but they're never themselves repositioned.
//   3. Remaining items are sorted by descending total footprint (copies ×
//      area) so large groups claim space before it fragments into slivers.
//   4. For each item, every free rectangle is evaluated at 0° and (when the
//      item isn't square) 90°, scoring each candidate by:
//        - added canvas height (heavily weighted — never grow the sheet if
//          an existing hole already fits, regardless of which hole),
//        - unused area within the candidate rect (tightest fit wins among
//          equally-good holes),
//        - fragmentation (a small penalty for leaving an unusably thin
//          sliver behind),
//        - a small rotation bias so rotating is only chosen when it's
//          actually the best option, not merely "different."
//      The lowest-scoring candidate is used.
//   5. Placing an item splits every free rectangle it overlaps into up to
//      four pieces, discards any that are now fully contained by another,
//      then merges adjacent pieces that recombine into one clean rectangle
//      (kept as its own explicit pass — plain MaxRects skips this and just
//      lets the free-rect list grow, but re-merging keeps later scoring
//      accurate and the list small).
//   6. If literally no free rectangle can hold an item, the usable area is
//      expanded downward by appending one new rectangle sized for it, and
//      placement is retried — this always succeeds.
//
// Deliberately structured as small, composable, pure functions (FreeRect
// list in, FreeRect list out; one placement decision at a time) rather than
// one monolithic loop, so a future enhancement — e.g. letting a single
// multi-copy item split across more than one free rectangle instead of
// requiring one atomic block — only needs a new "which chunk goes where"
// step in the middle, not a rewrite of the split/merge/scoring machinery.

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Relative weights for the placement score (lower is better). added-height
// dominates everything else so an existing hole always beats growing the
// sheet; unused-area then picks the tightest of several equally-valid holes;
// fragmentation and rotation are tie-breakers on top of that.
const SCORE_WEIGHT_ADDED_HEIGHT = 100000;
const SCORE_WEIGHT_UNUSED_AREA = 1;
const SCORE_WEIGHT_FRAGMENTATION = 500;
const SCORE_WEIGHT_ROTATION = 50;
// A remainder strip narrower/shorter than this is treated as unusable
// fragmentation rather than genuine free space.
const MIN_USABLE_SLIVER_IN = 0.5;
// Sentinel "infinite" height used only transiently to seed the very first
// free rectangle so pinned/locked items can be carved out of it correctly
// (see freeRectPack) — never left in the scored free-rect list itself.
const UNBOUNDED_HEIGHT_IN = 1_000_000;
// Any leftover piece still at (or near) the sentinel height once seeding is
// done gets discarded rather than scored — see freeRectPack for why.
const RESERVOIR_HEIGHT_THRESHOLD_IN = UNBOUNDED_HEIGHT_IN / 2;

/**
 * Uniform-grid index over placed footprints, for overlap queries.
 *
 * `evaluateSpill` has to know whether a candidate placement would collide with
 * anything already on the sheet. It did that with `placedBoxes.some(...)` — a
 * scan of every cell placed so far — run once per free rectangle, once per
 * item. Both the box list and the free-rect list grow with the design, so the
 * cost compounded to roughly O(n³): a 5000-item sheet spent ~2.4 seconds in
 * this one predicate, on the main thread, on *every* board change.
 *
 * A uniform grid suits this problem specifically: placements are similarly
 * sized (artwork on a 23.5in sheet), so buckets stay evenly populated and the
 * degenerate case a grid is bad at — wildly varying object sizes — does not
 * arise. A tree would cost more to maintain per insert for no benefit here.
 *
 * Boxes are stored pre-inflated by `gap`, and queries are inflated the same
 * way, so a bucket hit means the exact same interval-overlap test the original
 * predicate performed. The exact test is still re-run per candidate, so this
 * changes only *which boxes get compared*, never the answer.
 */
class PlacedBoxIndex {
  /** Bucket edge length, in inches. */
  private readonly cell: number;
  private readonly buckets = new Map<number, FreeRect[]>();
  /** Guards against a box being tested twice when it spans several buckets. */
  private readonly seen = new Map<FreeRect, number>();
  private query = 0;

  constructor(cellSizeIn: number) {
    // Never zero: a degenerate cell size would put every box in one bucket and
    // silently restore the linear scan.
    this.cell = Math.max(0.5, cellSizeIn);
  }

  /** Single integer key from a 2-D bucket coordinate. */
  private key(cx: number, cy: number): number {
    // Cantor-style pairing on non-negative coordinates. Layout coordinates are
    // sheet-relative and never negative, so an unsigned pairing is safe and
    // avoids allocating a string key per lookup.
    return cx * 73856093 + cy * 19349663;
  }

  insert(box: FreeRect, gap: number): void {
    const x0 = Math.floor(box.x / this.cell);
    const x1 = Math.floor((box.x + box.w + gap) / this.cell);
    const y0 = Math.floor(box.y / this.cell);
    const y1 = Math.floor((box.y + box.h + gap) / this.cell);

    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const bucket = this.buckets.get(k);
        if (bucket) bucket.push(box);
        else this.buckets.set(k, [box]);
      }
    }
  }

  /**
   * True when any placed box overlaps the given footprint.
   *
   * Deliberately identical in meaning to the original
   * `placedBoxes.some(b => …)` predicate — see the class comment.
   */
  overlaps(qx: number, qy: number, qw: number, qh: number, gap: number, eps = 0): boolean {
    const x0 = Math.floor(qx / this.cell);
    const x1 = Math.floor((qx + qw + gap) / this.cell);
    const y0 = Math.floor(qy / this.cell);
    const y1 = Math.floor((qy + qh + gap) / this.cell);

    const token = ++this.query;

    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.buckets.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const b of bucket) {
          if (this.seen.get(b) === token) continue;
          this.seen.set(b, token);
          // `eps` forgives float noise in a piece placed exactly at the gap;
          // the packer passes none, so its answers are unchanged.
          if (
            qx < b.x + b.w + gap - eps &&
            qx + qw + gap > b.x + eps &&
            qy < b.y + b.h + gap - eps &&
            qy + qh + gap > b.y + eps
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

/**
 * Grid index over a free-rectangle list, for containment queries.
 *
 * Same idea as `PlacedBoxIndex` but built once over a whole list and queried by
 * array position, which is what `placeAndSplit`'s prune needs. Kept separate
 * rather than generalised: the two have different lifecycles (this one is
 * disposable, that one accumulates) and merging them would mean a bucket
 * structure that supports neither well.
 */
class RectGrid {
  private readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  private readonly rects: FreeRect[];

  constructor(rects: FreeRect[]) {
    this.rects = rects;

    // Bucket edge tracks the median rectangle so occupancy stays near-constant
    // whatever scale the design is at. A fixed size would degenerate to one
    // bucket on a sheet of tiny slivers.
    let sum = 0;
    for (const r of rects) sum += r.w + r.h;
    const mean = rects.length ? sum / (rects.length * 2) : 1;
    this.cell = Math.max(0.25, mean);

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const x0 = Math.floor(r.x / this.cell);
      const x1 = Math.floor((r.x + r.w) / this.cell);
      const y0 = Math.floor(r.y / this.cell);
      const y1 = Math.floor((r.y + r.h) / this.cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cx * 73856093 + cy * 19349663;
          const bucket = this.buckets.get(k);
          if (bucket) bucket.push(i);
          else this.buckets.set(k, [i]);
        }
      }
    }
  }

  /** True when some rectangle other than `self` fully contains `r`. */
  anyContaining(r: FreeRect, self: number): boolean {
    // Only the rectangle's own buckets need checking: a container must cover
    // every point of `r`, so it necessarily occupies `r`'s top-left bucket.
    const cx = Math.floor(r.x / this.cell);
    const cy = Math.floor(r.y / this.cell);
    const bucket = this.buckets.get(cx * 73856093 + cy * 19349663);
    if (!bucket) return false;

    for (const j of bucket) {
      if (j === self) continue;
      const o = this.rects[j];
      if (
        o.x <= r.x + 1e-4 &&
        o.y <= r.y + 1e-4 &&
        o.x + o.w >= r.x + r.w - 1e-4 &&
        o.y + o.h >= r.y + r.h - 1e-4
      ) {
        return true;
      }
    }
    return false;
  }
}

// Picks how many columns a multi-row copies grid should use. Maximizing
// columns (the naive choice) minimizes rows, but a sparsely-filled last row
// still reserves its FULL width in the packer's bookkeeping — ArtboardItem's
// flow rendering only draws the first `copies % cols` cells of that row, so
// the rest reads as visibly empty canvas to the user while remaining
// entirely unusable to every other item. Falling back to fewer columns when
// that meaningfully shrinks the wasted cell count keeps a design's own last
// row from silently reserving space that should actually be up for grabs.
function bestColsForCopies(copies: number, maxColsFit: number): number {
  const capped = Math.min(copies, maxColsFit);
  if (copies <= maxColsFit) return capped; // fits in a single row — no waste possible
  const tolerance = Math.max(1, Math.ceil(copies * 0.2));
  for (let cols = maxColsFit; cols >= 1; cols--) {
    const rows = Math.ceil(copies / cols);
    const waste = cols * rows - copies;
    if (waste <= tolerance) return cols;
  }
  return maxColsFit;
}

export function computeGroupDims(
  w: number,
  h: number,
  copies: number,
  availW: number,
  gap: number,
) {
  const maxColsFit = Math.max(1, Math.floor((availW + gap) / (w + gap)));
  const cols = bestColsForCopies(copies, maxColsFit);
  const rows = Math.ceil(copies / cols);
  return {
    cols,
    rows,
    gw: cols * w + (cols - 1) * gap,
    gh: rows * h + (rows - 1) * gap,
  };
}

// The rectangles a copies-grid ACTUALLY fills, which is NOT its bounding box
// whenever the copy count doesn't divide evenly by the column count: the last
// row is short, and those trailing cells are real, usable space.
//
// Reserving the bounding box instead (the obvious implementation) hides that
// space from the packer completely — it can't be scored, can't be filled, and
// reads to the customer as unexplained blank canvas inside a design. Splitting
// the reservation into "full rows" + "partial last row" is what lets the
// existing scoring machinery treat those trailing cells as the ordinary free
// space they are, with no special-casing anywhere downstream.
function groupCellRects(
  x: number,
  y: number,
  w: number,
  h: number,
  cols: number,
  copies: number,
  gap: number,
): FreeRect[] {
  const rows = Math.ceil(copies / cols);
  const fullRows = rows - 1;
  const rects: FreeRect[] = [];
  if (fullRows > 0) {
    rects.push({
      x,
      y,
      w: cols * w + (cols - 1) * gap,
      h: fullRows * h + (fullRows - 1) * gap,
    });
  }
  const lastRowCount = copies - fullRows * cols;
  rects.push({
    x,
    y: y + fullRows * (h + gap),
    w: lastRowCount * w + (lastRowCount - 1) * gap,
    h,
  });
  return rects;
}

// Splits every free rectangle overlapping the placed footprint into up to
// four non-overlapping pieces, drops any now fully contained by another,
// then merges adjacent pieces back into single clean rectangles.
function placeAndSplit(
  freeRects: FreeRect[],
  px: number,
  py: number,
  pw: number,
  ph: number,
  gap: number,
): FreeRect[] {
  const fx2 = px + pw + gap;
  const fy2 = py + ph + gap;
  const next: FreeRect[] = [];
  for (const r of freeRects) {
    const rx2 = r.x + r.w;
    const ry2 = r.y + r.h;
    if (px >= rx2 || fx2 <= r.x || py >= ry2 || fy2 <= r.y) {
      next.push(r); // no overlap
      continue;
    }
    if (px > r.x) next.push({ x: r.x, y: r.y, w: px - r.x, h: r.h });
    if (fx2 < rx2) next.push({ x: fx2, y: r.y, w: rx2 - fx2, h: r.h });
    if (py > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: py - r.y });
    if (fy2 < ry2) next.push({ x: r.x, y: fy2, w: r.w, h: ry2 - fy2 });
  }

  /**
   * Drop degenerate slivers, then any rectangle fully contained by another.
   *
   * The containment test used to be `next.some(...)` inside `next.filter(...)`
   * — every surviving rectangle compared against every other, once per placed
   * cell. On a large sheet the free-rect list is long enough that this was ~43%
   * of all layout time.
   *
   * Containment implies overlap, so bucketing by grid cell and comparing only
   * against rectangles sharing a bucket yields exactly the same survivors: any
   * `o` that could contain `r` must occupy at least one of `r`'s buckets. The
   * predicate itself is unchanged and still decides every candidate.
   */
  const sized = next.filter((r) => r.w > 1e-4 && r.h > 1e-4);

  // Cheap for the short lists that dominate small boards; the index only pays
  // for itself once there is something to index.
  if (sized.length < 24) {
    return mergeFreeRects(
      sized.filter(
        (r, i) =>
          !sized.some(
            (o, j) =>
              j !== i &&
              o.x <= r.x + 1e-4 &&
              o.y <= r.y + 1e-4 &&
              o.x + o.w >= r.x + r.w - 1e-4 &&
              o.y + o.h >= r.y + r.h - 1e-4,
          ),
      ),
    );
  }

  const index = new RectGrid(sized);
  const pruned = sized.filter((r, i) =>
    !index.anyContaining(r, i),
  );

  return mergeFreeRects(pruned);
}

/**
 * Whether `a` and `b` share a full edge and can therefore be combined.
 *
 * Split from the rectangle construction deliberately. The search loop asks this
 * question O(m²) times and answers "no" almost always, so it must not allocate;
 * the combined rectangle is built only once, for the pair actually chosen.
 * (Returning a nullable rectangle from the hot loop instead cost ~43% of layout
 * time in allocation and call overhead alone.)
 */
function canMergePair(a: FreeRect, b: FreeRect): boolean {
  if (Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.w - b.w) < 1e-4) {
    if (Math.abs(a.y + a.h - b.y) < 1e-4) return true;
    if (Math.abs(b.y + b.h - a.y) < 1e-4) return true;
  }
  if (Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.h - b.h) < 1e-4) {
    if (Math.abs(a.x + a.w - b.x) < 1e-4) return true;
    if (Math.abs(b.x + b.w - a.x) < 1e-4) return true;
  }
  return false;
}

/** Builds the union of a pair already known to satisfy `canMergePair`. */
function mergePair(a: FreeRect, b: FreeRect): FreeRect {
  if (Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.w - b.w) < 1e-4) {
    if (Math.abs(a.y + a.h - b.y) < 1e-4) return { x: a.x, y: a.y, w: a.w, h: a.h + b.h };
    if (Math.abs(b.y + b.h - a.y) < 1e-4) return { x: b.x, y: b.y, w: b.w, h: b.h + a.h };
  }
  if (Math.abs(a.x + a.w - b.x) < 1e-4) return { x: a.x, y: a.y, w: a.w + b.w, h: a.h };
  return { x: b.x, y: b.y, w: b.w + a.w, h: b.h };
}

/**
 * Combines free rectangles that share a full edge, to a fixed point.
 *
 * Semantics are unchanged from the original: repeatedly find the
 * lexicographically first mergeable pair `(i, j)`, replace it with the merged
 * rectangle appended at the end, and restart. That ordering is load-bearing —
 * merging is not confluent in general, so a different order can yield a
 * different (still valid, but different) free-space decomposition, which would
 * move customers' artwork.
 *
 * What changed is only how much work each restart costs. The original rescanned
 * every pair from (0, 1) after each merge, making the routine roughly O(m³) and
 * ~45% of all layout time on a large sheet — yet nearly all of that rescanning
 * re-derived a conclusion it already had.
 *
 * The redundancy: when the merge happens at `(i, j)`, every pair before it in
 * lex order has just been shown non-mergeable, and mergeability depends only on
 * the two rectangles, not their positions. Removing `i` and `j` cannot make any
 * surviving pair mergeable. The *only* new possibilities involve the combined
 * rectangle appended at the end. So the restart needs to test the prefix
 * against that one new rectangle — O(i) — and can then resume scanning from
 * `i`, rather than re-testing O(m²) pairs to reach the same place.
 *
 * (An earlier attempt bucketed candidates by their (x, w) / (y, h) merge keys.
 * It was 3× *slower*: the buckets have to be rebuilt per merge, and the string
 * key construction cost far more than the plain float comparisons it saved.
 * The comparisons were never the problem; the repetition was.)
 */
function mergeFreeRects(rects: FreeRect[]): FreeRect[] {
  const list = rects.slice();
  if (list.length < 2) return list;

  let i = 0;
  while (i < list.length) {
    // Lexicographically first partner for `i`, matching the original's inner
    // loop exactly.
    const a = list[i];
    let j = -1;
    for (let k = i + 1; k < list.length; k++) {
      const b = list[k];
      // Inline rejection on the two cheap key comparisons. Almost every pair
      // fails here, and keeping that path free of calls is what makes the
      // O(m²) scan affordable.
      const sameColumn = Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.w - b.w) < 1e-4;
      const sameRow = Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.h - b.h) < 1e-4;
      if (!sameColumn && !sameRow) continue;
      if (canMergePair(a, b)) {
        j = k;
        break;
      }
    }

    if (j === -1) {
      i++;
      continue;
    }

    const combined = mergePair(list[i], list[j]);
    // High index first so the low index stays valid — the original spliced
    // `j` then `i` for the same reason.
    list.splice(j, 1);
    list.splice(i, 1);
    list.push(combined);

    // Everything before `i` was non-mergeable a moment ago and still is, except
    // where the new rectangle is involved. Test just that, then carry on.
    const newIdx = list.length - 1;
    let resume = i;
    const fresh = list[newIdx];
    for (let p = 0; p < i; p++) {
      if (canMergePair(list[p], fresh)) {
        resume = p;
        break;
      }
    }
    i = resume;
  }
  return list;
}

interface Candidate {
  fr: FreeRect;
  rot: 0 | 90;
  gw: number;
  gh: number;
  cols: number;
  score: number;
}

// Evaluates every free rectangle for one orientation of one item, folding
// the best result found into `best` (mutated in place so 0°/90°/fallback
// passes can share one accumulator).
function evaluateOrientation(
  freeRects: FreeRect[],
  w: number,
  h: number,
  copies: number,
  gap: number,
  maxUsedBottom: number,
  rot: 0 | 90,
  best: { candidate: Candidate | null },
) {
  for (const fr of freeRects) {
    if (fr.w < w - 1e-6) continue;
    const { cols, rows, gw, gh } = computeGroupDims(w, h, copies, fr.w, gap);
    if (gh > fr.h + 1e-6) continue; // must fit atomically within this rect

    const unusedArea = fr.w * fr.h - gw * gh;
    const addedHeight = Math.max(0, fr.y + gh - maxUsedBottom);

    const rightW = fr.w - gw - gap;
    const bottomH = fr.h - gh - gap;
    let slivers = 0;
    if (rightW > 1e-4 && rightW < MIN_USABLE_SLIVER_IN) slivers++;
    if (bottomH > 1e-4 && bottomH < MIN_USABLE_SLIVER_IN) slivers++;

    const score =
      addedHeight * SCORE_WEIGHT_ADDED_HEIGHT +
      unusedArea * SCORE_WEIGHT_UNUSED_AREA +
      slivers * SCORE_WEIGHT_FRAGMENTATION +
      (rot === 90 ? SCORE_WEIGHT_ROTATION : 0);

    if (!best.candidate || score < best.candidate.score) {
      best.candidate = { fr, rot, gw, gh, cols, score };
    }
    void rows;
  }
}

// Companion to evaluateOrientation for when a group needs MORE rows than a
// gap's own height allows — e.g. a 6-copy design that fits 3-per-row needs 2
// rows, but the tallest nearby gap only has room for 1. Rather than require
// the whole group to fit atomically, this lets it start in that gap and have
// its remaining rows continue straight down from that same origin — still
// one contiguous (if stepped) block, exactly how ArtboardItem already
// renders multi-row groups. Deliberately extending past the gap's own
// recorded height means it's only accepted once confirmed to not overlap
// anything already placed.
//
// Scored with the SAME formula as evaluateOrientation (not a separate,
// lower-priority pass) and fed into the SAME `best` accumulator as atomic
// candidates, so the genuinely better placement wins regardless of which
// strategy produced it. Trying atomic fits everywhere first and only
// falling back to spill when NOTHING atomic exists anywhere would let a
// small, distant, atomically-fitting sliver beat a much better spill option
// in a big, nearby gap purely because it was found "first" — this must run
// unconditionally alongside evaluateOrientation, not gated behind it.
function evaluateSpill(
  freeRects: FreeRect[],
  placedIndex: PlacedBoxIndex,
  w: number,
  h: number,
  copies: number,
  gap: number,
  maxUsedBottom: number,
  rot: 0 | 90,
  best: { candidate: Candidate | null },
) {
  for (const fr of freeRects) {
    if (fr.w < w - 1e-6 || fr.h < h - 1e-6) continue; // needs room for at least one row
    const cols = Math.max(1, Math.min(copies, Math.floor((fr.w + gap) / (w + gap))));
    const rows = Math.ceil(copies / cols);
    const gw = cols * w + (cols - 1) * gap;
    const gh = rows * h + (rows - 1) * gap;
    if (gh <= fr.h + 1e-6) continue; // fits atomically — evaluateOrientation already covers this

    if (placedIndex.overlaps(fr.x, fr.y, gw, gh, gap)) continue;

    // Leftover width within the ORIGINAL gap band, not the extended
    // footprint — the extension itself is accounted for via addedHeight,
    // same as evaluateOrientation.
    const unusedArea = fr.w * fr.h - gw * fr.h;
    const addedHeight = Math.max(0, fr.y + gh - maxUsedBottom);

    const score =
      addedHeight * SCORE_WEIGHT_ADDED_HEIGHT +
      unusedArea * SCORE_WEIGHT_UNUSED_AREA +
      (rot === 90 ? SCORE_WEIGHT_ROTATION : 0);

    if (!best.candidate || score < best.candidate.score) {
      best.candidate = { fr: { x: fr.x, y: fr.y, w: gw, h: gh }, rot, gw, gh, cols, score };
    }
  }
}

/** Compares two pieces for the order the packer places them in. */
type PackOrder = (a: LayoutItem, b: LayoutItem) => number;

const groupArea = (it: LayoutItem) => it.widthIn * it.heightIn * Math.max(1, it.copies || 1);

/**
 * The orders auto-nest tries, keeping whichever gives the shortest sheet.
 *
 * The sheet's width is fixed, so length is the only thing a layout can save,
 * and it is what the customer pays for. A greedy packer's result depends
 * heavily on the order pieces arrive in, and largest-area-first was the only
 * order ever tried. Measured on realistic boards, a plain shelf pack beat it on
 * four of six — 300 small pieces came out at 172in against the shelf's 164in.
 *
 * Largest-area-first stays first, so a board no other order makes strictly
 * shorter keeps exactly the layout it had.
 */
const PACK_ORDERS: PackOrder[] = [
  (a, b) => groupArea(b) - groupArea(a),
  (a, b) => b.heightIn - a.heightIn || b.widthIn - a.widthIn,
  (a, b) => b.widthIn - a.widthIn || b.heightIn - a.heightIn,
  (a, b) =>
    Math.max(b.widthIn, b.heightIn) - Math.max(a.widthIn, a.heightIn) || groupArea(b) - groupArea(a),
];

/**
 * Past this many pieces only the first order runs. The repack happens on every
 * board change, and trying every order costs about four single passes —
 * measured, under 90ms at 400 pieces but 730ms at 1,000 — so a large board
 * keeps a single pass rather than stalling each edit.
 */
const MULTI_ORDER_MAX_ITEMS = 400;

function freeRectPack(
  items: LayoutItem[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
  onlyPackIds?: Set<number>,
  /** Receives the ids of items that would not fit inside the sheet's length. */
  overflowedIds?: Set<number>,
  /** The order pieces are offered to the packer in. See PACK_ORDERS. */
  order: PackOrder = PACK_ORDERS[0],
  /**
   * "free" turns a piece whenever the score says the sheet comes out shorter;
   * "only-to-fit" turns one only when it would not fit the width upright, which
   * is what the packer used to do. Greedy packing can lose from an early turn,
   * so `calculateGridLayout` runs both and keeps the shorter sheet.
   */
  rotation: "free" | "only-to-fit" = "free",
): LayoutItem[] {
  const margin = Math.max(0, marginIn);
  const gap = Math.max(0, gapIn);
  const maxWidth = Math.max(0, canvasWidthIn - margin * 2);
  // When onlyPackIds is given, everything else is treated as immovable —
  // used by placeNewItems so freshly added artwork flows into existing gaps
  // without disturbing a single already-placed item.
  const isFixed = (it: LayoutItem) =>
    onlyPackIds ? !onlyPackIds.has(it.id) : Boolean(it.pinned || it.locked);

  const updatesById = new Map<number, LayoutItem>();
  // Seeded with one full-canvas, sentinel-tall rectangle SOLELY so pinned/
  // locked items below can be carved out of it correctly (a fixed item not
  // flush against the top-left corner needs real left/right/below pieces
  // split off around it). That sentinel height is never left in the list
  // that placement scoring actually sees — see the filter below — because
  // an "unbounded" free rect always scores as artificially tighter than any
  // genuinely bounded one purely from having a huge height, which is what
  // sent later items to a disconnected sliver instead of the obviously
  // bigger, closer gap next to a group. Real "expand downward" rows are
  // created on demand by the fallback further down, sized exactly for the
  // item that needed them — never with this sentinel.
  let freeRects: FreeRect[] = [{ x: 0, y: 0, w: maxWidth, h: UNBOUNDED_HEIGHT_IN }];
  let maxUsedBottom = 0;
  // Every rectangle actually occupied so far this run (fixed items, then
  // each packable item as it's placed) — used only by the spill pass below
  // to guarantee a placement that deliberately steps outside its originating
  // free rect's own recorded bounds still can't overlap anything real.
  //
  // Held in a spatial index rather than a flat array: the spill pass queries
  // it once per free rectangle per item, and a linear scan over every placed
  // cell made that the dominant cost on large sheets. Bucket size tracks the
  // sheet width so buckets stay populated at any zoom of the design.
  const placedIndex = new PlacedBoxIndex(Math.max(1, maxWidth / 4));

  // Pinned/locked items never move, but their footprint is stamped into the
  // free-space list up front so packable items are placed around them.
  const fixedItems = items.filter(isFixed);
  for (const it of fixedItems) {
    const copies = Math.max(1, it.copies || 1);
    const rotated = it.nestRotation === 90;
    const w = rotated ? it.heightIn : it.widthIn;
    const h = rotated ? it.widthIn : it.heightIn;
    const cols = it.flowCols && it.flowCols > 0 ? it.flowCols : computeGroupDims(w, h, copies, maxWidth, gap).cols;
    const rows = Math.ceil(copies / cols);
    const gw = cols * w + (cols - 1) * gap;
    const gh = rows * h + (rows - 1) * gap;
    const relX = it.posX - margin;
    const relY = it.posY - margin;
    for (const cell of groupCellRects(relX, relY, w, h, cols, copies, gap)) {
      freeRects = placeAndSplit(freeRects, cell.x, cell.y, cell.w, cell.h, gap);
      placedIndex.insert(cell, gap);
    }
    void gw;
    maxUsedBottom = Math.max(maxUsedBottom, relY + gh + gap);
  }
  /**
   * Bound the leftovers of the sentinel seed instead of discarding them.
   *
   * Carving a fixed item out of an unbounded reservoir leaves the strip beside
   * it just as unbounded, so the old filter threw that strip away along with
   * the seed. That is the space to the left and right of existing artwork —
   * exactly the space nesting is supposed to use — and while it was invisible
   * the incremental path (`placeNewItems`, which treats everything already on
   * the sheet as fixed) could only ever start a new row underneath.
   *
   * The genuine extent of such a strip is the bottom of the existing content:
   * past that point there is nothing to nest *beside*, and the fresh-row
   * fallback already covers growing the sheet downward. Clamping to
   * `maxUsedBottom` therefore turns the discarded remainder into the real gap
   * without inventing space. A strip with nothing left after the clamp — the
   * usual case when there are no fixed items at all, where `maxUsedBottom` is
   * still 0 — drops out exactly as it did before.
   */
  freeRects = freeRects.reduce<FreeRect[]>((kept, r) => {
    if (r.h < RESERVOIR_HEIGHT_THRESHOLD_IN) {
      kept.push(r);
      return kept;
    }
    const boundedH = maxUsedBottom - r.y;
    if (boundedH > MIN_USABLE_SLIVER_IN) kept.push({ ...r, h: boundedH });
    return kept;
  }, []);

  const packable = items
    .filter((it) => !isFixed(it))
    .sort(order);

  for (const item of packable) {
    const copies = Math.max(1, item.copies || 1);
    /*
     * Both orientations are offered; the score picks between them.
     *
     * The sheet's width is fixed, so its length is the only thing a layout can
     * save and the only thing the customer pays for — a piece is turned whenever
     * that makes the sheet shorter. Rotation used to be refused for a single
     * piece unless it was the only way it fit at all, so a portrait design was
     * laid out upright at its full height: a 10.8 x 16.3in photo took 16.4in of
     * roll where turning it takes 11in, under the minimum billable length.
     *
     * Turning is not free in the score (`SCORE_WEIGHT_ROTATION`), so a piece is
     * only turned when it genuinely buys length or fills a gap that upright
     * cannot — never on a tie.
     */
    const canRotate =
      !item.rigid &&
      Math.abs(item.widthIn - item.heightIn) >= 1e-4 &&
      (rotation === "free" || item.widthIn > maxWidth + 1e-6);

    // Atomic and spill candidates are evaluated together into one shared
    // accumulator — see evaluateSpill's comment for why running spill only
    // as a last resort (after exhausting atomic fits everywhere) would let
    // a small, distant, atomically-fitting sliver beat a much better spill
    // placement in a big, nearby gap just for being found first.
    const best: { candidate: Candidate | null } = { candidate: null };
    evaluateOrientation(freeRects, item.widthIn, item.heightIn, copies, gap, maxUsedBottom, 0, best);
    evaluateSpill(freeRects, placedIndex, item.widthIn, item.heightIn, copies, gap, maxUsedBottom, 0, best);
    if (canRotate) {
      evaluateOrientation(freeRects, item.heightIn, item.widthIn, copies, gap, maxUsedBottom, 90, best);
      evaluateSpill(freeRects, placedIndex, item.heightIn, item.widthIn, copies, gap, maxUsedBottom, 90, best);
    }

    // Starting a brand new full-width row is always a valid option too, and
    // it MUST be scored against whatever evaluateSpill just found rather
    // than only tried when nothing else exists. A narrow leftover sliver
    // can make evaluateSpill "succeed" by stacking many copies into a
    // single tall column (huge added height) — that candidate used to win
    // by default just for being the only one found, permanently starving a
    // much better fresh row of ever being considered and leaving the rest
    // of that sliver's row as a giant unused gap beside it.
    const fallbackDims0 = computeGroupDims(item.widthIn, item.heightIn, copies, maxWidth, gap);
    const fallbackRect0: FreeRect = { x: 0, y: maxUsedBottom, w: maxWidth, h: fallbackDims0.gh + gap };
    evaluateOrientation([fallbackRect0], item.widthIn, item.heightIn, copies, gap, maxUsedBottom, 0, best);
    let fallbackRect90: FreeRect | null = null;
    if (canRotate) {
      const fallbackDims90 = computeGroupDims(item.heightIn, item.widthIn, copies, maxWidth, gap);
      fallbackRect90 = { x: 0, y: maxUsedBottom, w: maxWidth, h: fallbackDims90.gh + gap };
      evaluateOrientation([fallbackRect90], item.heightIn, item.widthIn, copies, gap, maxUsedBottom, 90, best);
    }

    if (!best.candidate) continue; // pathological (item wider than the sheet) — leave as-is

    /**
     * The sheet's bottom edge.
     *
     * The packer had no ceiling: its fresh-row fallback is anchored at
     * `maxUsedBottom` and extends downward indefinitely, so it would happily
     * return positions past the end of the sheet. Measured, 25,000 one-inch
     * items packed to 1310in against a 1200in sheet.
     *
     * That did not surface while a 1200-*item* cap was doing the gating, since
     * no realistic sheet reached the length limit first. Now that length is
     * the real limit, this is the thing enforcing it: an item that cannot fit
     * inside the sheet is left unplaced and reported to the caller, rather
     * than being positioned into space that does not exist.
     */
    if (margin + best.candidate.fr.y + best.candidate.gh > MAX_SHEET_HEIGHT_IN + 1e-4) {
      overflowedIds?.add(item.id);
      continue;
    }

    const { fr, rot, gw, gh, cols } = best.candidate;
    // The fresh-row rect only actually represents free space once it wins —
    // stamp it into the real list now so placeAndSplit can carve the
    // leftover pieces (e.g. the rest of that row) out of it correctly.
    if (fr === fallbackRect0 || fr === fallbackRect90) freeRects.push(fr);
    // Reserve the cells this group genuinely fills, so a short last row leaves
    // its trailing cells behind as free space for the items packed after it.
    const cellW = rot === 90 ? item.heightIn : item.widthIn;
    const cellH = rot === 90 ? item.widthIn : item.heightIn;
    for (const cell of groupCellRects(fr.x, fr.y, cellW, cellH, cols, copies, gap)) {
      freeRects = placeAndSplit(freeRects, cell.x, cell.y, cell.w, cell.h, gap);
      placedIndex.insert(cell, gap);
    }
    void gw;
    maxUsedBottom = Math.max(maxUsedBottom, fr.y + gh + gap);

    updatesById.set(item.id, {
      ...item,
      posX: margin + fr.x,
      posY: margin + fr.y,
      nestRotation: rot,
      gravityActive: false,
      flowCols: cols,
      flowStartCol: 0,
      flowEndCol: (copies - 1) % cols,
    });
  }

  return items.map((it) => updatesById.get(it.id) ?? it);
}

/**
 * Groups, seen by the layout as single pieces.
 *
 * A group is a set of pieces the customer bundled to act as one. Every layout
 * pass — auto-nest, the displacement that makes room during a drag, the
 * re-spacing after a spacing change — places pieces one at a time, and would
 * scatter a group across the sheet. So each group is collapsed into one rigid
 * block the size of its members' combined footprint, laid out like any other
 * piece (never turned), and then every member is moved by exactly the offset
 * its block moved. The arrangement inside a group is never touched.
 */
export interface GroupCollapse<T extends LayoutItem> {
  /** Ungrouped pieces as they are, and one rigid block per group. */
  items: T[];
  /** The id the layout sees for a piece: its own, or its group block's. */
  unitOf: (id: number) => number;
  /** True when there was a group to collapse. */
  hasGroups: boolean;
  /** Pieces after a layout of `items`: members moved by their block's offset. */
  expand: (laidOut: LayoutItem[]) => T[];
  /** Per-piece moves from moves keyed by `unitOf` ids. */
  expandMoves: (
    moves: Map<number, { posX: number; posY: number }>,
  ) => Map<number, { posX: number; posY: number }>;
}

export function collapseGroups<T extends LayoutItem>(
  items: T[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): GroupCollapse<T> {
  const members = new Map<string, T[]>();
  for (const it of items) {
    if (!it.groupId) continue;
    const list = members.get(it.groupId) ?? [];
    list.push(it);
    members.set(it.groupId, list);
  }
  // A group of one is just a piece.
  for (const [id, list] of members) if (list.length < 2) members.delete(id);

  if (members.size === 0) {
    return {
      items,
      unitOf: (id) => id,
      hasGroups: false,
      expand: (laidOut) => laidOut as T[],
      expandMoves: (moves) => moves,
    };
  }

  const unitIdOfGroup = new Map<string, number>();
  const boxOfUnit = new Map<number, FootprintBox>();
  const groupOfUnit = new Map<number, string>();
  let nextUnit = -1;
  const units: T[] = [];
  for (const [groupId, list] of members) {
    const boxes = list.map((it) => getItemFootprint(it, canvasWidthIn, marginIn, gapIn));
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - x;
    const h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
    const unitId = nextUnit--;
    unitIdOfGroup.set(groupId, unitId);
    boxOfUnit.set(unitId, { x, y, w, h });
    groupOfUnit.set(unitId, groupId);
    units.push({
      ...(list[0] as T),
      id: unitId,
      widthIn: w,
      heightIn: h,
      posX: x,
      posY: y,
      copies: 1,
      flowCols: undefined,
      flowStartCol: undefined,
      flowEndCol: undefined,
      nestRotation: 0,
      // A member held in place holds the whole group.
      pinned: list.some((it) => it.pinned),
      locked: list.some((it) => it.locked),
      rigid: true,
    });
  }

  const unitOf = (id: number) => {
    const it = items.find((candidate) => candidate.id === id);
    return it?.groupId && unitIdOfGroup.has(it.groupId) ? unitIdOfGroup.get(it.groupId)! : id;
  };

  const shiftMembers = (unitId: number, posX: number, posY: number) => {
    const box = boxOfUnit.get(unitId)!;
    const dx = posX - box.x;
    const dy = posY - box.y;
    return members.get(groupOfUnit.get(unitId)!)!.map((m) => ({ ...m, posX: m.posX + dx, posY: m.posY + dy }));
  };

  return {
    items: [...items.filter((it) => !(it.groupId && members.has(it.groupId))), ...units],
    unitOf,
    hasGroups: true,
    expand: (laidOut) => {
      const out: T[] = [];
      for (const it of laidOut) {
        if (boxOfUnit.has(it.id)) out.push(...shiftMembers(it.id, it.posX, it.posY));
        else out.push(it as T);
      }
      // Keep the caller's order, so nothing downstream sees pieces reshuffled.
      const byId = new Map(out.map((it) => [it.id, it]));
      return items.map((it) => byId.get(it.id) ?? it);
    },
    expandMoves: (moves) => {
      const out = new Map<number, { posX: number; posY: number }>();
      for (const [id, move] of moves) {
        if (!boxOfUnit.has(id)) {
          out.set(id, move);
          continue;
        }
        for (const m of shiftMembers(id, move.posX, move.posY)) out.set(m.id, { posX: m.posX, posY: m.posY });
      }
      return out;
    },
  };
}

/** The combined footprint of some pieces. */
export function footprintBounds(
  items: LayoutItem[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): FootprintBox {
  const boxes = items.map((it) => getItemFootprint(it, canvasWidthIn, marginIn, gapIn));
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}

/**
 * A group turned a quarter clockwise, as one.
 *
 * Every member turns in place and its centre swings around the group's centre,
 * so the arrangement turns with it — turning each member where it stood would
 * leave the group pointing one way and its pieces another.
 */
export function rotateGroupClockwise<T extends LayoutItem & { rotation?: number; originalWidthIn?: number; originalHeightIn?: number }>(
  members: T[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): T[] {
  const box = footprintBounds(members, canvasWidthIn, marginIn, gapIn);
  const gcx = box.x + box.w / 2;
  const gcy = box.y + box.h / 2;
  return members.map((m) => {
    const fp = getItemFootprint(m, canvasWidthIn, marginIn, gapIn);
    const dx = fp.x + fp.w / 2 - gcx;
    const dy = fp.y + fp.h / 2 - gcy;
    const turned: T = {
      ...m,
      rotation: ((m.rotation ?? 0) + 90) % 360,
      widthIn: m.heightIn,
      heightIn: m.widthIn,
      originalWidthIn: m.originalHeightIn,
      originalHeightIn: m.originalWidthIn,
      // Columns were chosen for the old shape.
      flowCols: undefined,
      flowStartCol: undefined,
      flowEndCol: undefined,
    };
    const next = getItemFootprint(turned, canvasWidthIn, marginIn, gapIn);
    // Screen coordinates run downward, so a clockwise quarter maps (dx, dy) to (-dy, dx).
    return { ...turned, posX: gcx - dy - next.w / 2, posY: gcy + dx - next.h / 2 };
  });
}

/**
 * A group mirrored left to right, as one: every member is flipped, and its
 * position mirrored across the group's centre line.
 */
export function flipGroupHorizontally<T extends LayoutItem & { flipped?: boolean }>(
  members: T[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): T[] {
  const box = footprintBounds(members, canvasWidthIn, marginIn, gapIn);
  return members.map((m) => {
    const fp = getItemFootprint(m, canvasWidthIn, marginIn, gapIn);
    return { ...m, flipped: !m.flipped, posX: box.x + box.x + box.w - fp.x - fp.w + (m.posX - fp.x) };
  });
}

export const calculateGridLayout = (
  items: LayoutItem[],
  canvasWidth: number,
  spacing: number,
  autoNestStickers: boolean,
  margin: number = 0.15
): LayoutItem[] => {
  const groups = collapseGroups(items, canvasWidth, margin, Math.max(0, spacing));
  const laidOut = calculateGridLayoutFlat(groups.items, canvasWidth, spacing, autoNestStickers, margin);
  return groups.hasGroups ? groups.expand(laidOut) : laidOut;
};

const calculateGridLayoutFlat = (
  items: LayoutItem[],
  canvasWidth: number,
  spacing: number,
  autoNestStickers: boolean,
  margin: number = 0.15
): LayoutItem[] => {
  // The free-rectangle engine is the only layout implementation — it always
  // runs, whatever the auto-nest toggle's value. It also reserves each group's
  // TRUE cells rather than its bounding box (see groupCellRects), so the empty
  // cells of a short last row are ordinary free space that later items get
  // scored into like any other gap — no separate post-pass, and nothing ever
  // relocated out of a good spot to fill one.
  void autoNestStickers;
  const gap = Math.max(0, spacing);
  const orders = items.length > MULTI_ORDER_MAX_ITEMS ? PACK_ORDERS.slice(0, 1) : PACK_ORDERS;

  let best: LayoutItem[] = items;
  let bestOverflow = Infinity;
  let bestLength = Infinity;
  const consider = (candidate: LayoutItem[], overflow: number) => {
    const length = sheetContentLengthIn(candidate, canvasWidth, margin, gap);
    // Fewer pieces left off the sheet first, then shorter — strictly, so the
    // first order wins every tie.
    if (overflow < bestOverflow || (overflow === bestOverflow && length < bestLength - 1e-6)) {
      best = candidate;
      bestOverflow = overflow;
      bestLength = length;
    }
  };

  for (const order of orders) {
    for (const rotation of ["free", "only-to-fit"] as const) {
      const overflowed = new Set<number>();
      const candidate = freeRectPack(items, canvasWidth, margin, gap, undefined, overflowed, order, rotation);
      consider(candidate, overflowed.size);
    }
  }

  /*
   * A shelf pack is in the running too, wherever it can represent the board:
   * every piece a single copy, none pinned or locked, each within the printable
   * width. It neither rotates nor wraps copies, so anything else is out of reach.
   */
  const usableWidth = canvasWidth - 2 * Math.max(0, margin);
  if (
    items.length > 0 &&
    items.length <= MULTI_ORDER_MAX_ITEMS &&
    items.every(
      (it) => !it.pinned && !it.locked && Math.max(1, it.copies || 1) === 1 && it.widthIn <= usableWidth + 1e-6,
    )
  ) {
    const shelf = arrangeInitialLayout(items, canvasWidth, gap, margin);
    const overflow = shelf.filter((it) => {
      const fp = getItemFootprint(it, canvasWidth, margin, gap);
      return fp.y + fp.h > MAX_SHEET_HEIGHT_IN + 1e-4;
    }).length;
    consider(shelf, overflow);
  }

  return best;
};

/**
 * The columns an item's copies wrap into.
 *
 * What the artboard draws, what the print export lays out and what the billed
 * length measures. Sent with every order and saved design, so the export never
 * has to guess — it used to, with a rule of its own, and printed copy groups in
 * a different shape from the one the customer approved.
 */
export function resolveFlowCols(
  item: LayoutItem,
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): number {
  if (item.flowCols && item.flowCols > 0) return item.flowCols;
  const maxW = Math.max(0, canvasWidthIn - 2 * Math.max(0, marginIn));
  const rotated = item.nestRotation === 90;
  const w = Math.max(1e-6, rotated ? item.heightIn : item.widthIn);
  const h = Math.max(1e-6, rotated ? item.widthIn : item.heightIn);
  return computeGroupDims(w, h, Math.max(1, item.copies || 1), maxW, gapIn).cols;
}

/**
 * The bottom of the artwork, in inches: the length a sheet prints at, and so
 * the length it is billed at.
 *
 * Measured with the footprint the packer, the drag system and the renderer
 * share. The header used arithmetic of its own — a fixed 0.06in gap, the
 * unrotated size and as many columns as fit — so it ignored the spacing
 * setting, auto-nest's quarter turns and the columns auto-nest chose: eight
 * copies of an 11in square at 0.5in spacing print 45.5in and were quoted at
 * 44.18in.
 */
export function sheetContentLengthIn(
  items: LayoutItem[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): number {
  let bottom = 0;
  for (const it of items) {
    const fp = getItemFootprint(it, canvasWidthIn, marginIn, gapIn);
    // The renderer clamps a group against the sheet's end the same way.
    const top = Math.min(fp.y, MAX_SHEET_HEIGHT_IN - fp.h);
    bottom = Math.max(bottom, top + fp.h);
  }
  return Math.min(MAX_SHEET_HEIGHT_IN, Math.max(0, bottom));
}

/**
 * Packs ONLY the given new items into the gaps of the existing layout —
 * every other item is treated as an immovable obstacle. This is what keeps
 * adding artwork from rearranging the whole sheet: existing placements are
 * sacred; new pieces flow into whatever free space already exists (or extend
 * the sheet downward when nothing fits).
 */
export function placeNewItems(
  allItems: LayoutItem[],
  newIds: Set<number>,
  canvasWidth: number,
  spacing: number,
  margin: number = 0.15,
  /**
   * Optional out-param collecting ids that did not fit within the sheet's
   * 1200in length. Callers that can refuse an item (the drop handler) pass a
   * set and act on it; callers merely re-flowing an existing board omit it.
   */
  overflowedIds?: Set<number>,
): LayoutItem[] {
  return freeRectPack(
    allItems,
    canvasWidth,
    margin,
    Math.max(0, spacing),
    newIds,
    overflowedIds,
  );
}

/**
 * First-upload arrangement for a batch of images landing on an EMPTY board:
 * classic shelf packing (First-Fit Decreasing Height). Items are sorted
 * tallest-first and each is placed into the first row with enough remaining
 * width, so every row fills the sheet's full printable width before a new
 * one is opened — unlike the gap packer, whose fallback rows are sized to
 * the item that created them and can't accept anything taller, which left
 * most of the row's width unused on a fresh multi-image upload.
 *
 * Only meaningful for fresh single-copy uploads, so copies/flow geometry is
 * deliberately not handled here — callers use placeNewItems when the board
 * already has content.
 */
export function arrangeInitialLayout(
  items: LayoutItem[],
  canvasWidthIn: number,
  spacingIn: number,
  marginIn: number = 0.15,
): LayoutItem[] {
  const margin = Math.max(0, marginIn);
  const gap = Math.max(0, spacingIn);
  const usableW = Math.max(0, canvasWidthIn - 2 * margin);

  const sorted = [...items].sort(
    (a, b) => b.heightIn - a.heightIn || b.widthIn - a.widthIn,
  );

  interface Shelf {
    y: number;
    usedW: number;
    height: number;
  }
  const shelves: Shelf[] = [];
  const updatesById = new Map<number, LayoutItem>();

  for (const item of sorted) {
    const w = Math.min(item.widthIn, usableW);
    let shelf: Shelf | undefined;
    for (const s of shelves) {
      const needed = s.usedW > 0 ? s.usedW + gap + w : w;
      if (needed <= usableW + 1e-6) {
        shelf = s;
        break;
      }
    }
    if (!shelf) {
      const prev = shelves[shelves.length - 1];
      shelf = { y: prev ? prev.y + prev.height + gap : margin, usedW: 0, height: 0 };
      shelves.push(shelf);
    }
    const posX = margin + (shelf.usedW > 0 ? shelf.usedW + gap : 0);
    updatesById.set(item.id, {
      ...item,
      posX,
      posY: shelf.y,
      nestRotation: 0,
      flowCols: undefined,
      flowStartCol: undefined,
      flowEndCol: undefined,
      gravityActive: false,
    });
    shelf.usedW = posX - margin + w;
    // Height-sorted input means the first item on a shelf sets its height.
    shelf.height = Math.max(shelf.height, item.heightIn);
  }

  return items.map((it) => updatesById.get(it.id) ?? it);
}

// ── Localized Displacement (iOS-style) ────────────────────────────────────
// Instead of repacking the whole sheet whenever one item moves, only items
// that actually collide with the moved/changed item are displaced, and each
// is moved the LEAST possible: preferentially into the hole the dragged item
// just vacated (an icon-swap), otherwise a minimal straight nudge clear of
// the collision. Everything else stays exactly where it is, like rearranging
// icons on an iOS home screen — the rest of the layout never reflows.

export interface FootprintBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Full rendered footprint (copies grid included) of an item at its current position. */
export function getItemFootprint(
  item: LayoutItem,
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): FootprintBox {
  const margin = Math.max(0, marginIn);
  const maxW = Math.max(0, canvasWidthIn - 2 * margin);
  const rotated = item.nestRotation === 90;
  const w = Math.max(1e-6, rotated ? item.heightIn : item.widthIn);
  const h = Math.max(1e-6, rotated ? item.widthIn : item.heightIn);
  const copies = Math.max(1, item.copies || 1);
  const cols =
    item.flowCols && item.flowCols > 0
      ? item.flowCols
      : computeGroupDims(w, h, copies, maxW, gapIn).cols;
  const rows = Math.ceil(copies / cols);
  return {
    x: item.posX,
    y: item.posY,
    w: cols * w + (cols - 1) * gapIn,
    h: rows * h + (rows - 1) * gapIn,
  };
}

export interface FitResult<T> {
  item: T;
  /** Shrunk, keeping its proportions, because it was wider than the printable width. */
  scaled: boolean;
  /** Moved or reshaped to lie inside the printable width. */
  changed: boolean;
}

/**
 * A piece brought inside the sheet's safe print area — the margin lines.
 *
 * The roll cannot print past its edge, and the margin is the customer's own
 * clearance from it, so no piece may reach beyond either. Pieces used to be kept
 * inside only when a drag was validated: a piece pinned near the right edge and
 * then rotated, resized from the properties panel, uploaded wider than the sheet,
 * or left over from a wider roll kept its position and ran off the sheet — on
 * screen, in the price, and cut off in print. The top margin was enforced
 * nowhere at all, so artwork could sit above the "Safe Print Area" line.
 *
 *  1. One copy wider than the printable width is scaled down to fit, keeping
 *     its proportions (the width axis is the nested one when auto-nest turned it).
 *     With `canNestRotate` — auto-nest on, piece free to move — it is scaled only
 *     if it would not fit turned either, since the packer turns it to fit at
 *     full size.
 *  2. A copy group whose recorded columns no longer fit has them cleared, so the
 *     group re-wraps within the width.
 *  3. The piece is moved left, or down off the top margin, just far enough to
 *     lie inside the margins. The sheet grows downward, so there is no bottom
 *     bound here — `clampPosY` keeps a piece inside the sheet's maximum length.
 *
 * Returns the same object when nothing needed to change.
 */
export function fitItemToPrintableArea<T extends LayoutItem>(
  item: T,
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
  canNestRotate = false,
): FitResult<T> {
  const margin = Math.max(0, marginIn);
  const maxW = Math.max(0, canvasWidthIn - 2 * margin);
  const eps = 1e-4;
  if (!(maxW > 0)) return { item, scaled: false, changed: false };

  let next = item;
  let scaled = false;

  const cellW = canNestRotate
    ? Math.min(next.widthIn, next.heightIn)
    : next.nestRotation === 90
    ? next.heightIn
    : next.widthIn;
  if (cellW > maxW + eps) {
    const k = maxW / cellW;
    next = { ...next, widthIn: next.widthIn * k, heightIn: next.heightIn * k };
    scaled = true;
  }

  if (next.flowCols && getItemFootprint(next, canvasWidthIn, margin, gapIn).w > maxW + eps) {
    next = { ...next, flowCols: undefined, flowStartCol: undefined, flowEndCol: undefined };
  }

  const fp = getItemFootprint(next, canvasWidthIn, margin, gapIn);
  const maxPosX = Math.max(margin, canvasWidthIn - margin - fp.w);
  const posX = Math.max(margin, Math.min(next.posX, maxPosX));
  const posY = Math.max(margin, next.posY);
  if (Math.abs(posX - next.posX) > eps || Math.abs(posY - next.posY) > eps) {
    next = { ...next, posX, posY };
  }

  return { item: next, scaled, changed: next !== item };
}

/**
 * Groups brought inside the margins as one.
 *
 * The per-piece check clamps each piece on its own, which would pull one member
 * of a group back from the edge and leave the rest where they were. Each group
 * is moved by a single offset instead, so its arrangement survives. Returns the
 * same array when nothing moved.
 */
export function fitGroupsToPrintableArea<T extends LayoutItem>(
  items: T[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): { items: T[]; movedIds: Set<number> } {
  const margin = Math.max(0, marginIn);
  const movedIds = new Set<number>();
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (!it.groupId) continue;
    const list = groups.get(it.groupId) ?? [];
    list.push(it);
    groups.set(it.groupId, list);
  }
  const shift = new Map<number, { dx: number; dy: number }>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const box = footprintBounds(members, canvasWidthIn, margin, gapIn);
    const maxX = Math.max(margin, canvasWidthIn - margin - box.w);
    const dx = Math.max(margin, Math.min(box.x, maxX)) - box.x;
    const dy = Math.max(margin, box.y) - box.y;
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) continue;
    for (const m of members) {
      shift.set(m.id, { dx, dy });
      movedIds.add(m.id);
    }
  }
  if (shift.size === 0) return { items, movedIds };
  return {
    items: items.map((it) => {
      const d = shift.get(it.id);
      return d ? { ...it, posX: it.posX + d.dx, posY: it.posY + d.dy } : it;
    }),
    movedIds,
  };
}

const boxesCollide = (a: FootprintBox, b: FootprintBox, gap: number, eps = 1e-4) =>
  a.x < b.x + b.w + gap - eps &&
  a.x + a.w > b.x - gap + eps &&
  a.y < b.y + b.h + gap - eps &&
  a.y + a.h > b.y - gap + eps;

/**
 * Finds the free spot nearest to `box`'s current position that can hold it,
 * treating every other box as an obstacle. Reuses the same split/merge
 * machinery as the packer, but scores purely by travel distance so the item
 * lands in the closest gap rather than the globally "optimal" one — locality
 * is the point.
 */
function findNearestGap(
  selfId: number,
  box: FootprintBox,
  boxes: Map<number, FootprintBox>,
  canvasWidthIn: number,
  margin: number,
  gap: number,
): { x: number; y: number } | null {
  const maxW = Math.max(0, canvasWidthIn - 2 * margin);
  if (box.w > maxW + 1e-4) return null;

  let bottom = 0;
  for (const [oid, ob] of boxes) {
    if (oid !== selfId) bottom = Math.max(bottom, ob.y + ob.h);
  }
  // Free space covers the sheet down to just past the current content, so a
  // "gap" can also be the open area directly below everything.
  let free: FreeRect[] = [
    { x: 0, y: 0, w: maxW, h: Math.min(MAX_SHEET_HEIGHT_IN, bottom + box.h + gap + 1) },
  ];
  for (const [oid, ob] of boxes) {
    if (oid === selfId) continue;
    free = placeAndSplit(free, ob.x - margin, ob.y, ob.w, ob.h, gap);
  }

  let best: { x: number; y: number; d: number } | null = null;
  for (const fr of free) {
    if (fr.w + 1e-4 < box.w || fr.h + 1e-4 < box.h) continue;
    // Nearest valid position inside this rect to where the box already is.
    const px = Math.min(Math.max(box.x - margin, fr.x), fr.x + fr.w - box.w);
    const py = Math.min(Math.max(box.y, fr.y), fr.y + fr.h - box.h);
    const d = Math.hypot(px + margin - box.x, py - box.y);
    if (!best || d < best.d) best = { x: px + margin, y: py, d };
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Computes the minimal set of moves needed so nothing overlaps the items in
 * `activeIds` (or each other, transitively). Active items are immovable —
 * they're where the user put them. Returns ONLY the items that must move,
 * with their new positions; an empty map means the layout is already clean.
 *
 * Used both for the live displacement preview while dragging (results are
 * rendered as CSS transforms, not committed) and as the authoritative
 * resolution on drop / resize / rotate.
 */
export function planLocalDisplacement(
  items: LayoutItem[],
  activeIds: number[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
  activeOriginById?: Map<number, { posX: number; posY: number }>,
): Map<number, { posX: number; posY: number }> {
  const groups = collapseGroups(items, canvasWidthIn, marginIn, Math.max(0, gapIn));
  if (!groups.hasGroups) {
    return planLocalDisplacementFlat(items, activeIds, canvasWidthIn, marginIn, gapIn, activeOriginById);
  }
  const activeUnits = [...new Set(activeIds.map(groups.unitOf))];
  // A group's origin is its block at the members' pick-up positions.
  let unitOrigins: Map<number, { posX: number; posY: number }> | undefined;
  if (activeOriginById) {
    unitOrigins = new Map();
    for (const unitId of activeUnits) {
      if (unitId >= 0) {
        const origin = activeOriginById.get(unitId);
        if (origin) unitOrigins.set(unitId, origin);
        continue;
      }
      const memberOrigins = items
        .filter((it) => groups.unitOf(it.id) === unitId)
        .map((it) => activeOriginById.get(it.id) ?? { posX: it.posX, posY: it.posY });
      unitOrigins.set(unitId, {
        posX: Math.min(...memberOrigins.map((o) => o.posX)),
        posY: Math.min(...memberOrigins.map((o) => o.posY)),
      });
    }
  }
  const moves = planLocalDisplacementFlat(groups.items, activeUnits, canvasWidthIn, marginIn, gapIn, unitOrigins);
  return groups.expandMoves(moves);
}

function planLocalDisplacementFlat(
  items: LayoutItem[],
  activeIds: number[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
  // Where each active item was picked up FROM (its pre-drag position). The
  // gap this opens up is the preferred landing spot for whatever the active
  // item now overlaps — the icon-swap that keeps the rest of the sheet still.
  // Omitted by non-drag callers (resize/rotate reflow), which then fall back
  // to a plain minimal nudge.
  activeOriginById?: Map<number, { posX: number; posY: number }>,
): Map<number, { posX: number; posY: number }> {
  const margin = Math.max(0, marginIn);
  const gap = Math.max(0, gapIn);
  const eps = 1e-4;
  const activeSet = new Set(activeIds);
  const itemById = new Map(items.map((it) => [it.id, it]));

  const boxes = new Map<number, FootprintBox>();
  for (const it of items) {
    boxes.set(it.id, getItemFootprint(it, canvasWidthIn, marginIn, gap));
  }

  // Holes the dragged items left behind: their footprints at the positions
  // they were picked up from. A displaced neighbor prefers to slide into one
  // of these (taking the spot the dragged item just vacated) so nothing else
  // on the sheet has to move. Only meaningful once an active item has
  // actually travelled clear of its origin; empty for resize/rotate reflow.
  const vacated: FootprintBox[] = [];
  for (const id of activeIds) {
    const it = itemById.get(id);
    const cur = boxes.get(id);
    const origin = activeOriginById?.get(id);
    if (!it || !cur || !origin) continue;
    if (Math.abs(origin.posX - it.posX) > eps || Math.abs(origin.posY - it.posY) > eps) {
      vacated.push({ x: origin.posX, y: origin.posY, w: cur.w, h: cur.h });
    }
  }

  const moves = new Map<number, { posX: number; posY: number }>();

  const inBounds = (cand: FootprintBox) =>
    cand.x >= margin - eps &&
    cand.x + cand.w <= canvasWidthIn - margin + eps &&
    cand.y >= -eps &&
    cand.y + cand.h <= MAX_SHEET_HEIGHT_IN + eps;

  const isFree = (selfId: number, cand: FootprintBox) => {
    if (!inBounds(cand)) return false;
    for (const [oid, ob] of boxes) {
      if (oid === selfId) continue;
      if (boxesCollide(cand, ob, gap, eps)) return false;
    }
    return true;
  };

  // Cascade until clean: each pass displaces the single most-overlapped item,
  // which then becomes a displacer itself so any knock-on collision still
  // resolves, bounded hard so a pathological layout can't spin. In practice
  // the swap-into-vacated-hole path settles the common "drag into a group"
  // case in a single move, with no further cascade at all.
  for (let guard = 0; guard < 150; guard++) {
    let worst: { id: number; against: FootprintBox; area: number } | null = null;
    for (const [id, box] of boxes) {
      if (activeSet.has(id)) continue;
      const it = itemById.get(id);
      if (!it || it.locked) continue;
      for (const [oid, ob] of boxes) {
        if (oid === id) continue;
        // Only collisions introduced by the active items (directly or via a
        // cascade of earlier moves) are resolved — any pre-existing
        // static/static overlap is left untouched for stability.
        if (!activeSet.has(oid) && !moves.has(oid)) continue;
        if (!boxesCollide(box, ob, gap, eps)) continue;
        const ox = Math.min(box.x + box.w, ob.x + ob.w) - Math.max(box.x, ob.x) + gap;
        const oy = Math.min(box.y + box.h, ob.y + ob.h) - Math.max(box.y, ob.y) + gap;
        const area = Math.max(0, ox) * Math.max(0, oy);
        if (!worst || area > worst.area) worst = { id, against: ob, area };
      }
    }
    if (!worst) break;

    const worstId = worst.id;
    const box = boxes.get(worstId)!;
    const ob = worst.against;

    // Every candidate landing that fully clears the collider: the nearest
    // valid spot inside each vacated hole (the swap), plus a minimal straight
    // push in each direction. Pick whichever VALID one moves the item the
    // least — a sparse neighbor barely nudges, a boxed-in one swaps into the
    // hole, and nothing ever travels further than it has to.
    const candidates: { x: number; y: number }[] = [];
    for (const hole of vacated) {
      if (hole.w + eps < box.w || hole.h + eps < box.h) continue;
      const px = Math.min(Math.max(box.x, hole.x), hole.x + hole.w - box.w);
      const py = Math.min(Math.max(box.y, hole.y), hole.y + hole.h - box.h);
      candidates.push({ x: px, y: py });
    }
    candidates.push(
      { x: ob.x - gap - box.w, y: box.y },
      { x: ob.x + ob.w + gap, y: box.y },
      { x: box.x, y: ob.y - gap - box.h },
      { x: box.x, y: ob.y + ob.h + gap },
    );

    // Prefer a landing that keeps the neighbor in its CURRENT row (same y) so
    // it reflows sideways to make room, instead of popping up or down and
    // tearing an empty gap in the row. A vertical move is only taken when no
    // in-row landing is free. Within each group the closest valid spot still
    // wins, so nothing travels further than it must.
    const pickClosest = (rowPreserving: boolean): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const c of candidates) {
        if ((Math.abs(c.y - box.y) <= eps) !== rowPreserving) continue;
        if (!isFree(worstId, { x: c.x, y: c.y, w: box.w, h: box.h })) continue;
        const d = Math.hypot(c.x - box.x, c.y - box.y);
        if (d < bestD) {
          bestD = d;
          best = { x: c.x, y: c.y };
        }
      }
      return best;
    };
    let landed: { x: number; y: number } | null =
      pickClosest(true) ?? pickClosest(false);
    if (!landed) {
      // No clean swap or straight push — slide into the nearest existing gap.
      landed = findNearestGap(worst.id, box, boxes, canvasWidthIn, margin, gap);
    }
    if (!landed) {
      // Still nothing (dense sheet): take the shortest in-bounds push and let
      // the next passes displace whatever it now overlaps (the cascade).
      const c =
        [
          { x: ob.x - gap - box.w, y: box.y },
          { x: ob.x + ob.w + gap, y: box.y },
          { x: box.x, y: ob.y - gap - box.h },
          { x: box.x, y: ob.y + ob.h + gap },
        ]
          .map((c) => ({ ...c, d: Math.hypot(c.x - box.x, c.y - box.y) }))
          .sort((a, b) => a.d - b.d)
          .find(
            (c) =>
              c.x >= margin - eps &&
              c.x + box.w <= canvasWidthIn - margin + eps &&
              c.y >= -eps,
          ) ?? { x: box.x, y: box.y + ob.h + gap };
      landed = {
        x: Math.min(Math.max(c.x, margin), Math.max(margin, canvasWidthIn - margin - box.w)),
        y: Math.min(Math.max(0, c.y), MAX_SHEET_HEIGHT_IN - box.h),
      };
    }

    boxes.set(worst.id, { x: landed.x, y: landed.y, w: box.w, h: box.h });
    moves.set(worst.id, { posX: landed.x, posY: landed.y });
  }

  return moves;
}

/**
 * Moves apart pieces closer than the spacing allows — and nothing else.
 *
 * Spacing is the sheet's cutting clearance, so it has to hold for every piece,
 * including ones placed by hand. A hand-placed (pinned) piece used to be fixed
 * whatever the spacing: raising it re-spaced everything around that piece and
 * left the piece itself as close to its neighbours as before, so the control
 * looked as though it did nothing.
 *
 * Pieces settle in reading order. One that crowds a piece already settled moves
 * to the nearest spot clear of everything settled, found with the same gap
 * search a displaced neighbour uses; every other piece stays exactly where it
 * is. Locked pieces never move, and settle first so the others clear them.
 */
export function separateCrowdedItems(
  items: LayoutItem[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): Map<number, { posX: number; posY: number }> {
  const groups = collapseGroups(items, canvasWidthIn, marginIn, Math.max(0, gapIn));
  if (!groups.hasGroups) return separateCrowdedItemsFlat(items, canvasWidthIn, marginIn, gapIn);
  return groups.expandMoves(separateCrowdedItemsFlat(groups.items, canvasWidthIn, marginIn, gapIn));
}

function separateCrowdedItemsFlat(
  items: LayoutItem[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
): Map<number, { posX: number; posY: number }> {
  const margin = Math.max(0, marginIn);
  const gap = Math.max(0, gapIn);
  const ordered = [...items].sort(
    (a, b) =>
      Number(Boolean(b.locked)) - Number(Boolean(a.locked)) || a.posY - b.posY || a.posX - b.posX,
  );

  const settled = new Map<number, FootprintBox>();
  // Indexed, so checking a large board is not a comparison of every pair.
  const index = new PlacedBoxIndex(Math.max(1, (canvasWidthIn - 2 * margin) / 4));
  const moves = new Map<number, { posX: number; posY: number }>();

  for (const it of ordered) {
    let box = getItemFootprint(it, canvasWidthIn, margin, gap);
    if (!it.locked && index.overlaps(box.x, box.y, box.w, box.h, gap, 1e-4)) {
      /*
       * Searched with the piece padded by the spacing on its right and bottom.
       * The gap search only keeps clearance on an obstacle's right and bottom —
       * enough for the packer, which fills left to right and top down — so an
       * unpadded search could land a piece just left of, or above, a neighbour.
       * The spot is still checked before it is taken.
       */
      const padded = { ...box, w: box.w + gap, h: box.h + gap };
      const spot = findNearestGap(it.id, padded, settled, canvasWidthIn, margin, gap);
      if (spot && !index.overlaps(spot.x, spot.y, box.w, box.h, gap, 1e-4)) {
        box = { ...box, x: spot.x, y: spot.y };
        moves.set(it.id, { posX: spot.x, posY: spot.y });
      }
    }
    settled.set(it.id, box);
    index.insert(box, gap);
  }

  return moves;
}

export interface DragResolution {
  /** Neighbor moves that clear the way for the dragged item. Empty if invalid. */
  moves: Map<number, { posX: number; posY: number }>;
  /**
   * True when the dragged item fits at its current position — either the spot is
   * open, or every neighbor it touches can be displaced (into the vacated hole
   * or a nearby gap) with NO residual overlap and everything still on-sheet.
   * False when the target is blocked: something would overlap or spill off the
   * sheet no matter how neighbors are pushed. The caller rejects the drop and
   * springs the item back to where it was picked up.
   */
  valid: boolean;
}

/**
 * The authoritative "can this drop happen?" check, used every drag frame and
 * again on release. It runs planLocalDisplacement to see how neighbors would
 * flow out of the way, then VERIFIES the resulting layout is actually clean —
 * planLocalDisplacement always returns some plan (its dense-sheet last resort
 * can leave a residual overlap), so the verification is what turns "here's my
 * best attempt" into a hard valid/invalid verdict.
 *
 * A placement is rejected when any item touched by the move (the dragged item
 * itself, or a displaced neighbor) would still overlap another with less than
 * `gap` clearance, or would land outside the printable sheet. Pre-existing
 * overlaps that don't involve a moved item are ignored, so an already-messy
 * board can't wedge every drop as invalid.
 */
export function resolveDragPlacement(
  items: LayoutItem[],
  activeIds: number[],
  canvasWidthIn: number,
  marginIn: number,
  gapIn: number,
  activeOriginById?: Map<number, { posX: number; posY: number }>,
): DragResolution {
  const margin = Math.max(0, marginIn);
  const gap = Math.max(0, gapIn);
  const eps = 1e-4;

  const moves = planLocalDisplacement(
    items,
    activeIds,
    canvasWidthIn,
    marginIn,
    gap,
    activeOriginById,
  );

  // Every id that ended up somewhere new — the dragged items (immovable in the
  // plan, but their projected position is what we're validating) plus each
  // displaced neighbor. Only overlaps that involve one of these can be blamed
  // on the drop, so those are the only ones that can reject it.
  const changed = new Set<number>(activeIds);
  for (const id of moves.keys()) changed.add(id);

  const projected = items.map((it) => {
    const m = moves.get(it.id);
    return m ? { ...it, posX: m.posX, posY: m.posY } : it;
  });

  const boxes = projected.map((it) => ({
    id: it.id,
    ...getItemFootprint(it, canvasWidthIn, marginIn, gap),
  }));

  // Bounds: any moved item pushed outside the margins fails the drop.
  for (const b of boxes) {
    if (!changed.has(b.id)) continue;
    if (
      b.x < margin - eps ||
      b.x + b.w > canvasWidthIn - margin + eps ||
      b.y < margin - eps ||
      b.y + b.h > MAX_SHEET_HEIGHT_IN + eps
    ) {
      return { moves: new Map(), valid: false };
    }
  }

  // Overlap: no box may sit within `gap` of another once the plan is applied —
  // except two members of one group, whose spacing is the customer's own.
  const groupOf = new Map(projected.map((it) => [it.id, it.groupId]));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!changed.has(boxes[i].id) && !changed.has(boxes[j].id)) continue;
      const gi = groupOf.get(boxes[i].id);
      if (gi && gi === groupOf.get(boxes[j].id)) continue;
      if (boxesCollide(boxes[i], boxes[j], gap, eps)) {
        return { moves: new Map(), valid: false };
      }
    }
  }

  return { moves, valid: true };
}

export const calculateDropPosition = (
  items: LayoutItem[],
  newItem: LayoutItem,
  canvasWidth: number,
  topCenterY: number,
  spacing: number = 0.5,
  margin: number = 0.15
): { targetX: number; targetY: number } => {
  const selectionBuffer = CANVAS.SELECTION_BUFFER_IN;
  const minSpacing = Math.max(spacing, 0.3);
  const maxWidth = canvasWidth - margin * 2;
  const allItems = [...items, newItem];

  const rows: LayoutItem[][] = [];
  let currentRow: LayoutItem[] = [];
  let currentRowWidth = 0;

  allItems.forEach((it) => {
    const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
    const { width } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
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
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const { width } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
      return sum + (width + selectionBuffer) + (idx > 0 ? minSpacing : 0);
    }, 0);
    let currentX = margin + (maxWidth - rowWidth) / 2;
    const maxHeight = Math.max(...row.map((it) => {
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const { height } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
      return height + selectionBuffer;
    }));

    for (const it of row) {
      if (it.id === newItem.id) {
        targetX = currentX + selectionBuffer / 2;
        found = true;
        break;
      }
      const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
      const { width } = getRenderedGroupSize(it.widthIn, it.heightIn, copies, maxWidth);
      currentX += width + selectionBuffer + minSpacing;
    }

    if (found) break;
    targetY += maxHeight + minSpacing;
  }

  return { targetX, targetY };
};

/**
 * Bottom edge of the sheet's content, in inches.
 *
 * Copies wrap vertically, so an item's true extent is its group height, not
 * `heightIn` — the same worst-case reckoning the drop clamp and the canvas
 * extent use, kept in one place so all three agree.
 */
export function sheetContentBottomIn(items: LayoutItem[]): number {
  let bottom = 0;
  for (const it of items) {
    const copies = typeof it.copies === "number" && it.copies > 0 ? it.copies : 1;
    const h = typeof it.heightIn === "number" ? it.heightIn : 0;
    const y = typeof it.posY === "number" ? it.posY : 0;
    const groupH = copies <= 1 ? h : copies * h + (copies - 1) * SHEET_GROUP_GAP_IN;
    bottom = Math.max(bottom, y + groupH);
  }
  return bottom;
}

/** Inches of sheet still available below the current content. */
export function remainingSheetHeightIn(items: LayoutItem[]): number {
  return Math.max(0, MAX_SHEET_HEIGHT_IN - sheetContentBottomIn(items));
}

/**
 * Whether the sheet has run out of length.
 *
 * This — not a count of images — is what limits how much artwork a sheet
 * holds. The 1in tolerance mirrors the canvas's own "full" indicator so the
 * gate and the badge cannot disagree by a hair and leave a customer looking
 * at a full sheet that still accepts a file.
 */
export function isSheetFull(items: LayoutItem[]): boolean {
  return sheetContentBottomIn(items) >= MAX_SHEET_HEIGHT_IN - 1;
}

/**
 * Whether auto-nest would turn a rotated piece straight back.
 *
 * With auto-nest on, the layout pass lays each piece whichever way uses the
 * least film. A quarter turn the packer disagrees with is undone by its own
 * quarter turn on top, so the footprint stays put and the artwork shows (and
 * prints) upside down. Rotate asks this first, on a copy of the board, and
 * declines with an explanation instead of applying a turn that won't stick.
 *
 * Mirrors the per-piece step of `rotateSelected` (rotation +90, width and
 * height swapped) and the auto-nest pass in `useArtboardEffects`. Groups are
 * never turned by the packer, so callers leave them out.
 */
export function autoNestWouldUndoRotation<T extends LayoutItem & { rotation?: number }>(
  items: T[],
  ids: ReadonlySet<number>,
  canvasWidth: number,
  spacing: number,
  margin: number,
): boolean {
  // Which way the piece's footprint lies on the sheet: 0 as uploaded, 1 turned.
  const lies = (it: { rotation?: number; nestRotation?: number }) =>
    ((Math.round(((it.rotation ?? 0) + (it.nestRotation ?? 0)) / 90) % 2) + 2) % 2;
  const before = new Map(items.filter((it) => ids.has(it.id)).map((it) => [it.id, lies(it)]));
  if (before.size === 0) return false;
  const rotated = items.map((it) =>
    ids.has(it.id)
      ? { ...it, rotation: ((it.rotation ?? 0) + 90) % 360, widthIn: it.heightIn, heightIn: it.widthIn }
      : it,
  );
  const laidOut = calculateGridLayout(rotated, canvasWidth, spacing, true, margin) as Array<T>;
  return laidOut.some((it) => before.has(it.id) && lies(it) === before.get(it.id));
}
