import { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ArtboardItem } from "../../types";
import { CANVAS, MAX_SHEET_HEIGHT_IN } from "../../../../config/artboard.config";
import toast from "react-hot-toast";
import { getSheetWidthIn } from "../../../../lib/utils/pricingRates";
import type { CommitHistory } from "./useHistory";
import {
  getItemFootprint,
  resolveDragPlacement,
} from "../utils/layoutHelpers";

// Elements the drag system needs to find at runtime (owned by CanvasContainer).
const SCROLL_CONTAINER_ID = "artboard-scroll-container";
const CANVAS_INNER_ID = "artboard-canvas-inner";

// Edge auto-scroll: starts when the pointer is within the zone of the scroll
// viewport's top/bottom edge, speeding up the deeper into the zone it goes.
const EDGE_SCROLL_ZONE_PX = 56;
const EDGE_SCROLL_MAX_PX_PER_FRAME = 22;

export interface DropIndicator {
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  valid: boolean;
}

export interface PreviewOffset {
  dx: number;
  dy: number;
}

interface DragSession {
  ids: number[];
  primaryId: number;
  /** Pointer position in canvas inches at drag start. */
  pointerStart: { x: number; y: number };
  latestClient: { x: number; y: number };
  startPositions: Map<number, { posX: number; posY: number }>;
  canvasEl: HTMLElement | null;
  scrollEl: HTMLElement | null;
  raf: number | null;
  /** Last displacement plan — committed verbatim on drop so what the user saw is what they get. */
  lastMoves: Map<number, { posX: number; posY: number }>;
  /**
   * Whether the dragged footprint fits at the latest pointer position. Mirrors
   * the drop indicator's color and decides the drop outcome: a valid release
   * commits (dragged item + neighbor flow), an invalid one springs back.
   */
  lastValid: boolean;
}

const offsetsEqual = (a: Map<number, PreviewOffset>, b: Map<number, PreviewOffset>) => {
  if (a.size !== b.size) return false;
  for (const [id, o] of b) {
    const p = a.get(id);
    if (!p || Math.abs(p.dx - o.dx) > 1e-3 || Math.abs(p.dy - o.dy) > 1e-3) return false;
  }
  return true;
};

export const useMouseInteractions = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  selectedId: number | null,
  zoom: number,
  snapToGrid: boolean,
  snapToGridPoint: (value: number) => number,
  autoNestStickers: boolean,
  canvasWidth: number,
  marginSize: number,
  spacing: number,
  commitHistory?: CommitHistory,
  onRequestAutoNest?: (enabled: boolean) => void,
  setSelectedId?: (id: number) => void,
  setSelectedIds?: React.Dispatch<React.SetStateAction<Set<number>>>,
  selectedIds?: Set<number>,
) => {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [isDraggingItem, setIsDraggingItem] = useState(false);

  const resizeRef = useRef<{
    isActive: boolean;
    start: { x: number; y: number; width: number; height: number } | null;
    selectedId: number | null;
  } | null>(null);
  // Visual state the canvas renders from during a drag:
  //  - liftedIds: items showing the iOS "lift" (scale + shadow)
  //  - previewOffsets: neighbors displaced out of the way, as transforms only
  //  - dropIndicator: outline of where the dragged footprint will land
  const [liftedIds, setLiftedIds] = useState<Set<number>>(() => new Set());
  const [previewOffsets, setPreviewOffsets] = useState<Map<number, PreviewOffset>>(
    () => new Map(),
  );
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const dragRef = useRef<DragSession | null>(null);
  // Always-fresh items snapshot so drag handlers (which may live in memoized
  // children with stale closures) never read an outdated position.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const warnedMaxHeightRef = useRef(false);

  const getGroupHeightWorstIn = (item: Pick<ArtboardItem, "heightIn" | "copies">) => {
    const heightIn = typeof item.heightIn === "number" ? item.heightIn : 0;
    const copies = typeof item.copies === "number" && item.copies > 0 ? item.copies : 1;
    const gap = CANVAS.GRID_GAP_IN;
    return copies <= 1 ? heightIn : copies * heightIn + (copies - 1) * gap;
  };

  const maybeToastMaxHeight = () => {
    if (warnedMaxHeightRef.current) return;
    toast.error("Max sheet height of 1200 inches reached.");
    warnedMaxHeightRef.current = true;
  };

  const handleResizeStart = (e: React.MouseEvent, itemId: number) => {
    e.stopPropagation();
    const item = itemsRef.current.find((it) => it.id === itemId);
    if (!item) return;
    commitHistory?.();
    const startData = {
      x: e.clientX,
      y: e.clientY,
      width: item.widthIn,
      height: item.heightIn,
    };
    resizeRef.current = {
      isActive: true,
      start: startData,
      selectedId: itemId,
    };
    setIsResizing(true);
    setResizeStart(startData);
  };

  const handleDragStart = (e: React.MouseEvent, itemId: number) => {
    const current = itemsRef.current;
    const item = current.find((it) => it.id === itemId);
    if (!item || item.locked) return;
    commitHistory?.();

    // Multi-selection drag: grabbing a member of the current multi-selection
    // moves the whole selection as one rigid group (relative positions
    // preserved). Grabbing anything else collapses selection to that item.
    const sel = selectedIdsRef.current;
    let ids: number[];
    if (sel && sel.size > 1 && sel.has(itemId)) {
      ids = current.filter((it) => sel.has(it.id) && !it.locked).map((it) => it.id);
      setSelectedId?.(itemId);
    } else {
      ids = [itemId];
      setSelectedId?.(itemId);
      setSelectedIds?.(new Set([itemId]));
    }
    if (ids.length === 0) return;

    /**
     * Take ownership of every rendered element: stop in-flight settle tweens
     * and zero their transforms so the drag starts clean.
     *
     * One `querySelectorAll` rather than a `querySelector` per item. The old
     * loop issued one DOM query per item on every single drag start, so
     * grabbing anything on a thousand-item sheet meant a thousand attribute
     * lookups plus a thousand GSAP calls before the pointer moved — which is
     * what made dragging progressively heavier as a design grew.
     *
     * Querying the DOM also naturally limits the work to items that are
     * actually mounted: off-screen items are culled by the viewport
     * virtualization and have no element to tween.
     */
    const mounted = document.querySelectorAll<HTMLElement>("[data-item-id]");
    for (const el of mounted) {
      gsap.killTweensOf(el);
      gsap.set(el, { x: 0, y: 0 });
    }

    // Set membership instead of `ids.includes(...)` inside a scan — that was
    // O(items × selection) on a path that runs for every drag.
    const idSet = new Set(ids);
    if (current.some((it) => idSet.has(it.id) && it.isDropping)) {
      setItems((prev) =>
        prev.map((it) => (idSet.has(it.id) ? { ...it, isDropping: false } : it)),
      );
    }

    const canvasEl = document.getElementById(CANVAS_INNER_ID);
    const scrollEl = document.getElementById(SCROLL_CONTAINER_ID);
    const ppz = CANVAS.PIXELS_PER_INCH * zoom;
    const rect = canvasEl?.getBoundingClientRect();
    const pointerStart = rect
      ? { x: (e.clientX - rect.left) / ppz, y: (e.clientY - rect.top) / ppz }
      : { x: 0, y: 0 };

    dragRef.current = {
      ids,
      primaryId: itemId,
      pointerStart,
      latestClient: { x: e.clientX, y: e.clientY },
      // Built from one pass over `current` rather than a `find` per selected
      // id, which was O(items × selection) — noticeable when dragging a large
      // multi-selection.
      startPositions: (() => {
        const positions = new Map<number, { posX: number; posY: number }>();
        for (const it of current) {
          if (idSet.has(it.id)) positions.set(it.id, { posX: it.posX, posY: it.posY });
        }
        return positions;
      })(),
      canvasEl,
      scrollEl,
      raf: null,
      lastMoves: new Map(),
      lastValid: true,
    };
    setLiftedIds(new Set(ids));
    setIsDraggingItem(true);
  };

  useEffect(() => {
    if (!isResizing || !resizeStart || selectedId == null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const resize = resizeRef.current;
      if (!resize || !resize.isActive || !resize.start) return;

      const start = resize.start;
      setItems((prevItems) => {
        const item = prevItems.find((it) => it.id === resize.selectedId);
        if (!item) return prevItems;

        const deltaX = (e.clientX - start.x) / (CANVAS.PIXELS_PER_INCH * zoom);
        const deltaY = (e.clientY - start.y) / (CANVAS.PIXELS_PER_INCH * zoom);
        const newWidth = Math.max(0.01, start.width + deltaX);
        const newHeight = Math.max(0.01, start.height + deltaY);

        if (item.linked) {
          const ratio = start.height / start.width;
          const avgDelta = (deltaX + deltaY / ratio) / 2;
          const rawWidth = Math.max(0.5, start.width + avgDelta);

          const maxPrintableWidth = (canvasWidth || getSheetWidthIn()) - 2 * marginSize;
          const widthAfterWidthClamp = Math.min(rawWidth, maxPrintableWidth);
          // Silently clamped. A drag handle that stops at the sheet edge is
          // self-explanatory direct manipulation — the pointer keeps moving and
          // the item does not — so an error toast on top of it only added noise.

          const finalWidth = widthAfterWidthClamp;
          const finalHeight = finalWidth * ratio;

          // Clamp height so even in worst-case vertical wrapping, the item group bottom fits.
          const copies = typeof item.copies === "number" && item.copies > 0 ? item.copies : 1;
          const gap = CANVAS.GRID_GAP_IN;
          const maxHeightInByBottom =
            (MAX_SHEET_HEIGHT_IN - (copies - 1) * gap) / Math.max(1, copies);
          const clampedHeight = Math.min(finalHeight, maxHeightInByBottom);
          const clampedWidth = clampedHeight / ratio;

          const groupHeightWorstIn = getGroupHeightWorstIn({
            heightIn: clampedHeight,
            copies,
          });
          const maxPosY = Math.max(0, MAX_SHEET_HEIGHT_IN - groupHeightWorstIn);
          const didClamp =
            clampedHeight !== finalHeight || item.posY > maxPosY;
          if (didClamp) maybeToastMaxHeight();

          return prevItems.map((it) =>
            it.id === resize.selectedId
              ? {
                  ...it,
                  widthIn: clampedWidth,
                  heightIn: clampedHeight,
                  posY: Math.min(it.posY, maxPosY),
                }
              : it,
          );
        } else {
          const maxPrintableWidth = (canvasWidth || getSheetWidthIn()) - 2 * marginSize;
          const clampedWidth = Math.min(newWidth, maxPrintableWidth);
          // Silently clamped — see the linked-resize branch above.

          const copies = typeof item.copies === "number" && item.copies > 0 ? item.copies : 1;
          const gap = CANVAS.GRID_GAP_IN;
          const maxHeightInByBottom =
            (MAX_SHEET_HEIGHT_IN - (copies - 1) * gap) / Math.max(1, copies);
          const clampedHeight = Math.min(newHeight, maxHeightInByBottom);
          const groupHeightWorstIn = getGroupHeightWorstIn({
            heightIn: clampedHeight,
            copies,
          });
          const maxPosY = Math.max(0, MAX_SHEET_HEIGHT_IN - groupHeightWorstIn);
          const didClamp =
            clampedHeight !== newHeight || item.posY > maxPosY;
          if (didClamp) maybeToastMaxHeight();

          return prevItems.map((it) =>
            it.id === resize.selectedId
              ? {
                  ...it,
                  widthIn: clampedWidth,
                  heightIn: clampedHeight,
                  posY: Math.min(it.posY, maxPosY),
                }
              : it,
          );
        }
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isResizing, resizeStart, selectedId, zoom, setItems, canvasWidth, marginSize]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (resizeRef.current) {
        resizeRef.current.isActive = false;
        resizeRef.current = null;
      }
      setIsResizing(false);
      setResizeStart(null);
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!isDraggingItem || !dragRef.current) return;
    const drag = dragRef.current;
    const sheetW = canvasWidth || getSheetWidthIn();
    const ppz = CANVAS.PIXELS_PER_INCH * zoom;

    // One rAF step: auto-scroll, position the dragged items under the pointer,
    // and refresh the displacement preview + drop indicator. All per-frame
    // work is bounded and state writes are skipped when nothing changed, so
    // the drag stays pointer-locked at display refresh rate.
    const step = () => {
      drag.raf = null;
      if (dragRef.current !== drag) return;

      // Edge auto-scroll — pointer position is re-read against the canvas
      // AFTER scrolling, so the item keeps tracking the pointer exactly.
      let scrolling = false;
      if (drag.scrollEl) {
        const r = drag.scrollEl.getBoundingClientRect();
        const y = drag.latestClient.y;
        if (y < r.top + EDGE_SCROLL_ZONE_PX && drag.scrollEl.scrollTop > 0) {
          const f = Math.min(1, (r.top + EDGE_SCROLL_ZONE_PX - y) / EDGE_SCROLL_ZONE_PX);
          drag.scrollEl.scrollTop -= Math.ceil(f * EDGE_SCROLL_MAX_PX_PER_FRAME);
          scrolling = true;
        } else if (y > r.bottom - EDGE_SCROLL_ZONE_PX) {
          const before = drag.scrollEl.scrollTop;
          const f = Math.min(1, (y - (r.bottom - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX);
          drag.scrollEl.scrollTop += Math.ceil(f * EDGE_SCROLL_MAX_PX_PER_FRAME);
          scrolling = drag.scrollEl.scrollTop !== before;
        }
      }

      const rect = drag.canvasEl?.getBoundingClientRect();
      if (!rect) return;
      const pointerX = (drag.latestClient.x - rect.left) / ppz;
      const pointerY = (drag.latestClient.y - rect.top) / ppz;
      let deltaX = pointerX - drag.pointerStart.x;
      let deltaY = pointerY - drag.pointerStart.y;

      // Clamp the group's shared delta so EVERY dragged footprint stays on the
      // printable sheet — relative positions inside a multi-selection never
      // deform, the whole group just stops at the boundary.
      const current = itemsRef.current;
      // Built once per frame. Both this clamp loop and the preview-offset pass
      // below looked items up with `current.find(...)`, so each drag frame was
      // O(items × selection) — the cost that made dragging on a large sheet
      // degrade as the design grew.
      const currentById = new Map(current.map((i) => [i.id, i]));
      let minDX = -Infinity, maxDX = Infinity, minDY = -Infinity, maxDY = Infinity;
      for (const id of drag.ids) {
        const it = currentById.get(id);
        const start = drag.startPositions.get(id);
        if (!it || !start) continue;
        const fp = getItemFootprint(it, sheetW, marginSize, spacing);
        minDX = Math.max(minDX, marginSize - start.posX);
        maxDX = Math.min(maxDX, sheetW - marginSize - fp.w - start.posX);
        minDY = Math.max(minDY, -start.posY);
        maxDY = Math.min(maxDY, MAX_SHEET_HEIGHT_IN - fp.h - start.posY);
      }
      if (maxDX < minDX) maxDX = minDX;
      if (maxDY < minDY) maxDY = minDY;
      const clampedY = Math.max(minDY, Math.min(deltaY, maxDY));
      // Only warn on the BOTTOM (max-height) clamp — hitting the top edge
      // (deltaY < minDY) is a normal boundary stop, not a sheet-height limit.
      if (deltaY > maxDY) maybeToastMaxHeight();
      deltaX = Math.max(minDX, Math.min(deltaX, maxDX));
      deltaY = clampedY;

      if (snapToGrid) {
        const p0 = drag.startPositions.get(drag.primaryId);
        if (p0) {
          deltaX = snapToGridPoint(p0.posX + deltaX) - p0.posX;
          deltaY = snapToGridPoint(p0.posY + deltaY) - p0.posY;
        }
      }

      setItems((prev) => {
        let changed = false;
        const next = prev.map((it) => {
          const start = drag.startPositions.get(it.id);
          if (!start) return it;
          const nx = start.posX + deltaX;
          const ny = start.posY + deltaY;
          if (Math.abs(nx - it.posX) < 1e-6 && Math.abs(ny - it.posY) < 1e-6) return it;
          changed = true;
          return { ...it, posX: nx, posY: ny };
        });
        return changed ? next : prev;
      });

      // Live displacement preview, iOS-home-screen style: project the dragged
      // items to the pointer, then resolve how the neighbors would flow out of
      // the way — AND whether they actually can. The verdict drives everything:
      //   valid   → neighbors slide aside (rendered as transforms, committed on
      //             drop) and the drop indicator glows blue.
      //   invalid → the target is blocked; neighbors hold still and the
      //             indicator turns amber to telegraph the coming snap-back.
      const projected = current.map((it) => {
        const start = drag.startPositions.get(it.id);
        return start ? { ...it, posX: start.posX + deltaX, posY: start.posY + deltaY } : it;
      });
      const { moves, valid } = resolveDragPlacement(
        projected,
        drag.ids,
        sheetW,
        marginSize,
        spacing,
        drag.startPositions,
      );
      drag.lastMoves = moves;
      drag.lastValid = valid;

      // Neighbors are nudged out of the way ONLY while the placement is valid.
      // The offset is measured against each item's still-unchanged committed
      // position, so clearing it on drop (as left/top jumps by the same amount)
      // is a zero-movement swap — no post-drop settle jump.
      setPreviewOffsets((prev) => {
        const nextOffsets = new Map<number, PreviewOffset>();
        if (valid) {
          for (const [id, mv] of moves) {
            const it = currentById.get(id);
            if (!it) continue;
            nextOffsets.set(id, { dx: mv.posX - it.posX, dy: mv.posY - it.posY });
          }
        }
        return offsetsEqual(prev, nextOffsets) ? prev : nextOffsets;
      });

      const primary = projected.find((i) => i.id === drag.primaryId);
      if (primary) {
        const fp = getItemFootprint(primary, sheetW, marginSize, spacing);
        setDropIndicator((prev) => {
          if (
            prev &&
            prev.valid === valid &&
            Math.abs(prev.xIn - fp.x) < 1e-3 &&
            Math.abs(prev.yIn - fp.y) < 1e-3 &&
            Math.abs(prev.wIn - fp.w) < 1e-3 &&
            Math.abs(prev.hIn - fp.h) < 1e-3
          )
            return prev;
          return { xIn: fp.x, yIn: fp.y, wIn: fp.w, hIn: fp.h, valid };
        });
      }

      // Keep scrolling smoothly while the pointer sits parked in the edge zone.
      if (scrolling && drag.raf == null) drag.raf = requestAnimationFrame(step);
    };

    const handleMouseMove = (e: MouseEvent) => {
      drag.latestClient = { x: e.clientX, y: e.clientY };
      if (drag.raf == null) drag.raf = requestAnimationFrame(step);
    };

    const handleMouseUp = () => {
      if (drag.raf != null) cancelAnimationFrame(drag.raf);
      drag.raf = null;

      const moves = drag.lastMoves;

      if (drag.lastValid) {
        // Accepted drop. Commit exactly what the user saw: the dragged items
        // stay where they were released, and every neighbor that flowed aside
        // during the drag is written to its previewed position. All are pinned
        // so the post-drop layout pass leaves them put. Clearing the preview
        // offsets in the same commit makes the transform→left/top handoff a
        // zero-movement swap — nothing jumps.
        setItems((prev) =>
          prev.map((it) => {
            if (drag.startPositions.has(it.id)) {
              // Pinned where it was released. Its columns are kept: the drop was
              // validated against this shape, and clearing them re-wrapped a copy
              // group wider, over the neighbours it had just been placed beside.
              return { ...it, pinned: true, gravityActive: false };
            }
            const mv = moves.get(it.id);
            if (mv) {
              return {
                ...it,
                posX: mv.posX,
                posY: mv.posY,
                pinned: true,
                gravityActive: false,
              };
            }
            return it;
          }),
        );
      } else {
        // Rejected drop — the target is blocked. Capture how far each dragged
        // item travelled from where it was picked up, reset it to that origin
        // in state, then spring the element back across that gap with an
        // elastic ease, iOS-style. Neighbors never moved (offsets stayed
        // empty while invalid), so only the dragged items animate.
        const PPI = CANVAS.PIXELS_PER_INCH;
        const springs: Array<{ id: number; dxPx: number; dyPx: number }> = [];
        for (const id of drag.ids) {
          const start = drag.startPositions.get(id);
          const cur = itemsRef.current.find((i) => i.id === id);
          if (!start || !cur) continue;
          springs.push({
            id,
            dxPx: (cur.posX - start.posX) * PPI,
            dyPx: (cur.posY - start.posY) * PPI,
          });
        }

        setItems((prev) =>
          prev.map((it) => {
            const start = drag.startPositions.get(it.id);
            return start
              ? {
                  ...it,
                  posX: start.posX,
                  posY: start.posY,
                  pinned: true,
                  gravityActive: false,
                }
              : it;
          }),
        );

        // React commits the origin position at the end of this handler (before
        // paint), so seeding the transform to the drop-point offset here means
        // the first painted frame shows the item still at the drop point; the
        // tween then carries it home. clearProps wipes the inline transform so
        // it never fights a later displacement preview.
        for (const { id, dxPx, dyPx } of springs) {
          if (Math.abs(dxPx) < 0.5 && Math.abs(dyPx) < 0.5) continue;
          const el = document.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null;
          if (!el) continue;
          gsap.killTweensOf(el);
          gsap.fromTo(
            el,
            { x: dxPx, y: dyPx },
            {
              x: 0,
              y: 0,
              duration: 0.62,
              ease: "elastic.out(1, 0.62)",
              clearProps: "transform",
            },
          );
        }
      }

      setPreviewOffsets(new Map());
      setDropIndicator(null);
      setLiftedIds(new Set());
      setIsDraggingItem(false);
      dragRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (drag.raf != null) {
        cancelAnimationFrame(drag.raf);
        // Must be reset, not just cancelled — if a dep change re-runs this
        // effect mid-drag, the next mousemove's "already scheduled?" check
        // would otherwise see the dead handle and never schedule again.
        drag.raf = null;
      }
    };
  }, [isDraggingItem, zoom, snapToGrid, snapToGridPoint, setItems, canvasWidth, marginSize, spacing]);

  return {
    handleResizeStart,
    handleDragStart,
    isDraggingItem,
    isResizing,
    liftedIds,
    previewOffsets,
    dropIndicator,
  };
};
