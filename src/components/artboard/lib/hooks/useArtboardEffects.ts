import { useEffect, useState, useRef } from "react";
import { ArtboardItem } from "../../types";
import { billableSheetDimensions } from "../../../../lib/utils/pricingRates";
import { animateItemPosition } from "../utils";
import {
  calculateGridLayout,
  getRenderedGroupSize,
  isLowDpi,
  isUnknownDpi,
  computeGroupDims,
  planLocalDisplacement,
  getItemFootprint,
  sheetContentLengthIn,
  separateCrowdedItems,
} from "../utils";
import { snapToGridPoint } from "../utils";
import { CANVAS, PRICING, UNIT, MAX_SHEET_HEIGHT_IN } from "../../../../config/artboard.config";
import { usePricingSettings } from "../../../../lib/utils/pricingRates";
import toast from "react-hot-toast";

export const useArtboardEffects = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  selectedId: number | null,
  snapToGrid: boolean,
  canvasWidth: number,
  spacing: number,
  autoNestStickers: boolean,
  marginSize: number,
  isDraggingItem: boolean,
  isResizing: boolean,
  showRulers: boolean,
  onHeaderInfoChange?: (info: any) => void,
  initialData?: any,
  onDataChange?: (data: any) => void,
  counter?: number
) => {
  /*
   * The whole settings snapshot, not just the rate.
   *
   * Watching `pricePerSqFt` alone meant a change to the roll width or the
   * minimum length never reached this effect — the rate compared equal, React
   * bailed out, and the board kept the compiled fallback for the session.
   */
  const pricingSettings = usePricingSettings();
  const pricePerSqFt = pricingSettings.pricePerSqFt;
  const [originalPositions, setOriginalPositions] = useState<
    Record<number, { posX: number; posY: number }>
  >({});
  // The roll width is part of the sheet's geometry: changing it in admin re-fits the board.
  const [lastConfig, setLastConfig] = useState({ marginSize, spacing, canvasWidth });
  const prevItemsRef = useRef<ArtboardItem[]>([]);
  const warnedMaxHeightRef = useRef(false);
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounced so a burst of rapid edits (e.g. dragging a copies stepper,
  // several quick duplicates) coalesces into one repack instead of running
  // the full free-rectangle engine on every intermediate state.
  const REBUILD_DEBOUNCE_MS = 150;

  // Load initial data
  useEffect(() => {
    if (initialData) {
      setItems(initialData.items || []);
    }
  }, [initialData, setItems]);

  // Export data changes
  useEffect(() => {
    if (onDataChange) {
      onDataChange({ items, counter });
    }
  }, [items, counter, onDataChange]);


  // Animate items only when gravity is active (and not suppressed by a copies change)
  useEffect(() => {
    items.forEach((it) => {
      if (!it.gravityActive || it.skipAnimation) return;

      const element = document.querySelector(
        `[data-item-id="${it.id}"]`
      ) as HTMLElement;
      if (!element) return;

      const prevItem = prevItemsRef.current.find(p => p.id === it.id);
      // Skip if position hasn't actually changed — avoids spurious shake before layout runs.
      if (
        prevItem &&
        Math.abs(it.posX - prevItem.posX) <= 0.001 &&
        Math.abs(it.posY - prevItem.posY) <= 0.001
      ) return;

      animateItemPosition(element, it.posX, it.posY, true, prevItem?.posX, prevItem?.posY);
    });

    // Update ref after animation trigger
    prevItemsRef.current = items;
  }, [items]);

  // Layout maintenance runs in one of two modes, chosen by the Auto-Nest
  // toggle:
  //
  //  • Auto-Nest ON  — CONTINUOUS gravity nesting. Every change (move, resize,
  //    rotate, copies, add) re-optimizes the WHOLE sheet from scratch via the
  //    free-rectangle engine (largest items settle to the top), so the board is
  //    always in a perfectly arranged state. Even items the user hand-dragged
  //    (pinned) get folded back in. Turning the toggle on after arranging
  //    things by hand therefore snaps everything back to a clean nest.
  //
  //  • Auto-Nest OFF — the iOS-icon model. A change to one item only displaces
  //    the neighbors it actually collides with (see planLocalDisplacement);
  //    everything else stays exactly where the user put it. A margin/spacing
  //    change still triggers one global re-gap (honoring pinned placements),
  //    since the geometry rules themselves changed.
  //
  // Either way this is skipped while the user is actively resizing/dragging
  // (the drag system owns collision resolution during a drag) or while a
  // just-dropped item's entrance animation is still playing.
  const geomKey = (it: ArtboardItem) =>
    `${it.posX.toFixed(3)}|${it.posY.toFixed(3)}|${it.widthIn.toFixed(4)}|${it.heightIn.toFixed(4)}|${it.copies}|${it.rotation}|${it.nestRotation ?? 0}`;
  const lastResolvedRef = useRef<Map<number, string> | null>(null);
  const prevAutoNestOnRef = useRef(autoNestStickers);

  useEffect(() => {
    const isAnyItemDropping = items.some(it => it.isDropping);

    if (isResizing || isDraggingItem || canvasWidth === 0 || isAnyItemDropping) {
      prevItemsRef.current = items;
      if (rebuildTimerRef.current) {
        clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = null;
      }
      return;
    }

    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    rebuildTimerRef.current = setTimeout(() => {
      rebuildTimerRef.current = null;

      const configChanged =
        lastConfig.marginSize !== marginSize ||
        lastConfig.spacing !== spacing ||
        lastConfig.canvasWidth !== canvasWidth;
      if (configChanged) {
        setLastConfig({ marginSize, spacing, canvasWidth });
      }
      // Capture the OFF→ON transition before overwriting the ref — turning
      // auto-nest on must force a repack even if no item geometry changed.
      const autoNestJustTurnedOn = autoNestStickers && !prevAutoNestOnRef.current;
      prevAutoNestOnRef.current = autoNestStickers;

      const effectiveMargin = marginSize;
      const maxAvailableWidth = Math.max(0, canvasWidth - 2 * effectiveMargin);
      let didClamp = false;

      const clampPosY = (u: { widthIn: number; heightIn: number; copies?: number; posY: number }) => {
        const copies = typeof u.copies === "number" && u.copies > 0 ? u.copies : 1;
        const { height: groupH } = getRenderedGroupSize(u.widthIn, u.heightIn, copies, maxAvailableWidth);
        const maxPosY = Math.max(0, MAX_SHEET_HEIGHT_IN - groupH);
        const nextPosY = Math.max(0, Math.min(u.posY, maxPosY));
        if (nextPosY < u.posY - 0.001) didClamp = true;
        return nextPosY;
      };

      const snapshotAndBail = () => {
        lastResolvedRef.current = new Map(items.map((it) => [it.id, geomKey(it)]));
      };

      // Non-geometric change guard: if nothing that affects layout changed
      // (same items, identical geomKeys), leave the canvas EXACTLY as-is — no
      // repack, no displacement, no position writes. This is what makes locking
      // an item (or any interaction-only toggle like flip) purely change its
      // state without rearranging the board, even when Auto-Nest is on. A
      // config change or the auto-nest turning on still forces the repack below.
      const prevKeysForGuard = lastResolvedRef.current;
      if (prevKeysForGuard && !configChanged && !autoNestJustTurnedOn) {
        const noLayoutChange =
          prevKeysForGuard.size === items.length &&
          items.every((it) => prevKeysForGuard.get(it.id) === geomKey(it));
        if (noLayoutChange) {
          snapshotAndBail();
          return;
        }
        // Free-placement guard: when the ONLY change is pinned (hand-dragged)
        // items being MOVED — a pure position change, nothing resized — the
        // user just repositioned them by hand, so leave every other image
        // EXACTLY where it is (a drag moves only the dragged image). A resize,
        // rotation or copy-count change alters the size fields, so it is NOT
        // caught here and still reflows neighbors to stay gap-free and
        // collision-free, even for a pinned item.
        const changed = items.filter(
          (it) => prevKeysForGuard.get(it.id) !== geomKey(it),
        );
        const isPurePositionMove = (it: ArtboardItem) => {
          const prev = prevKeysForGuard.get(it.id);
          if (prev === undefined) return false;
          // geomKey = posX|posY|widthIn|heightIn|copies|rotation|nestRotation.
          // Only the two position fields may differ for a plain drag.
          const p = prev.split("|");
          const c = geomKey(it).split("|");
          return p[2] === c[2] && p[3] === c[3] && p[4] === c[4] && p[5] === c[5] && p[6] === c[6];
        };
        if (changed.length > 0 && changed.every((it) => it.pinned && isPurePositionMove(it))) {
          snapshotAndBail();
          return;
        }
      }

      let updatesToUse: ArtboardItem[];

      /*
       * Auto-nest ON re-nests the whole sheet on every change. With it off, a
       * spacing or margin change no longer re-nests anything: every group's
       * columns are re-fitted to the new gap below, and then, in both modes,
       * only pieces now closer than the spacing move (`separateCrowdedItems`).
       * Re-nesting here rearranged a hand-built board for a nudge of the
       * spacing, yet left hand-placed pieces as close together as before.
       */
      const runGlobalPack = autoNestStickers;
      if (runGlobalPack) {
        // Strip `pinned` ONLY at the moment auto-nest is switched on, so a
        // hand-arranged board snaps into a clean nest on that toggle. While
        // auto-nest simply stays on, a pin set by dragging is respected — the
        // dragged item keeps its dropped position and everything else nests
        // around it, instead of snapping back on the next repack.
        const source = autoNestJustTurnedOn
          ? items.map((it) => (it.pinned ? { ...it, pinned: false } : it))
          : items;
        const updates = calculateGridLayout(
          source,
          canvasWidth,
          spacing,
          autoNestStickers,
          effectiveMargin,
        ) as ArtboardItem[];
        updatesToUse = updates.map((u) => ({ ...u, posY: clampPosY(u) }));
      } else {
        // Diff against the last resolved layout to find what actually changed.
        const prevKeys = lastResolvedRef.current;
        const changedIds: number[] = [];
        for (const it of items) {
          const key = prevKeys?.get(it.id);
          // A spacing or margin change reshapes every group, so every item counts.
          if (configChanged || key === undefined || key !== geomKey(it)) changedIds.push(it.id);
        }
        if ((prevKeys === null && !configChanged) || changedIds.length === 0) {
          snapshotAndBail();
          return;
        }

        // Refresh the changed items' own copies-grid geometry (a copies or
        // size change reshapes their flow), clamp them into the sheet, then
        // displace only whatever neighbors they now collide with.
        const changedSet = new Set(changedIds);
        const withFlow = items.map((it) => {
          if (!changedSet.has(it.id)) return it;
          const copies = Math.max(1, it.copies || 1);
          const rotated = it.nestRotation === 90;
          const w = rotated ? it.heightIn : it.widthIn;
          const h = rotated ? it.widthIn : it.heightIn;
          const next: ArtboardItem = { ...it, posY: clampPosY(it) };
          if (copies > 1) {
            const { cols } = computeGroupDims(
              Math.max(1e-6, w),
              Math.max(1e-6, h),
              copies,
              maxAvailableWidth,
              spacing,
            );
            next.flowCols = cols;
            next.flowStartCol = 0;
            next.flowEndCol = (copies - 1) % cols;
          } else {
            next.flowCols = undefined;
            next.flowStartCol = undefined;
            next.flowEndCol = undefined;
          }
          // Keep the changed item's own footprint inside the printable width.
          const fp = getItemFootprint(next, canvasWidth, effectiveMargin, spacing);
          const maxPosX = Math.max(effectiveMargin, canvasWidth - effectiveMargin - fp.w);
          next.posX = Math.max(effectiveMargin, Math.min(next.posX, maxPosX));
          return next;
        });

        const moves = planLocalDisplacement(withFlow, changedIds, canvasWidth, effectiveMargin, spacing);
        updatesToUse = withFlow.map((it) => {
          const m = moves.get(it.id);
          if (!m) return it;
          return { ...it, posX: m.posX, posY: clampPosY({ ...it, posY: m.posY }) };
        });
      }

      // The spacing is the sheet's cutting clearance: once it or the margin
      // changes, anything now too close is moved apart, hand-placed pieces too.
      if (configChanged) {
        const apart = separateCrowdedItems(updatesToUse, canvasWidth, effectiveMargin, spacing);
        if (apart.size > 0) {
          updatesToUse = updatesToUse.map((it) => {
            const m = apart.get(it.id);
            return m ? { ...it, posX: m.posX, posY: clampPosY({ ...it, posY: m.posY }) } : it;
          });
        }
      }

      if (didClamp && !warnedMaxHeightRef.current) {
        toast.error("Max sheet height of 1200 inches reached.");
        warnedMaxHeightRef.current = true;
      }

      lastResolvedRef.current = new Map(updatesToUse.map((it) => [it.id, geomKey(it)]));

      setItems((prev) => {
        // Indexed once. Both passes below used `updatesToUse.find(...)` per
        // item, so resolving a layout was quadratic in item count — and this
        // runs on every board change, not just on upload.
        const updateById = new Map(updatesToUse.map((u) => [u.id, u]));

        const needsUpdate = prev.some(it => {
          const update = updateById.get(it.id);
          if (!update) return false;
          // Check position AND flow geometry — flow shape can change without position moving
          // (e.g. copies count changes within an already-placed group in the same lane).
          return (
            Math.abs(update.posX - it.posX) > 0.001 ||
            Math.abs(update.posY - it.posY) > 0.001 ||
            update.flowCols !== it.flowCols ||
            update.flowStartCol !== it.flowStartCol ||
            update.flowEndCol !== it.flowEndCol ||
            (update.nestRotation ?? 0) !== (it.nestRotation ?? 0)
          );
        });

        if (!needsUpdate && !prev.some((it) => it.skipAnimation)) return prev;

        return prev.map((it) => {
          const update = updateById.get(it.id);
          if (!update) return it.skipAnimation ? { ...it, skipAnimation: false } : it;

          const hasMoved = Math.abs(update.posX - it.posX) > 0.001 || Math.abs(update.posY - it.posY) > 0.001;
          if (
            !hasMoved &&
            update.flowCols === it.flowCols &&
            update.flowStartCol === it.flowStartCol &&
            update.flowEndCol === it.flowEndCol &&
            (update.nestRotation ?? 0) === (it.nestRotation ?? 0) &&
            !it.skipAnimation &&
            !it.gravityActive
          ) {
            return it;
          }

          return {
            ...it,
            posX: update.posX,
            posY: update.posY,
            flowCols: update.flowCols,
            flowStartCol: update.flowStartCol,
            flowEndCol: update.flowEndCol,
            nestRotation: (update.nestRotation ?? 0) as 0 | 90,
            // When a copies change triggered this reflow, suppress animation and clear the flag.
            gravityActive: it.skipAnimation ? false : hasMoved,
            skipAnimation: false,
          };
        });
      });
    }, REBUILD_DEBOUNCE_MS);

    return () => {
      if (rebuildTimerRef.current) {
        clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = null;
      }
    };
  }, [items, canvasWidth, autoNestStickers, spacing, marginSize, lastConfig, setItems, isDraggingItem, isResizing]);

  // Clear nest-rotation when auto-nest is turned off so items revert to their
  // natural orientation instead of remaining in the layout-assigned rotation.
  const prevAutoNestRef = useRef(autoNestStickers);
  useEffect(() => {
    const wasOn = prevAutoNestRef.current;
    prevAutoNestRef.current = autoNestStickers;
    if (wasOn && !autoNestStickers) {
      setItems(prev =>
        prev.map(it =>
          (it.nestRotation ?? 0) !== 0 ? { ...it, nestRotation: 0 as const } : it
        )
      );
    }
  }, [autoNestStickers, setItems]);

  // Snap to grid
  useEffect(() => {
    if (snapToGrid) {
      setOriginalPositions((prev) => {
        const newOriginals = { ...prev };
        items.forEach((it) => {
          if (!newOriginals[it.id]) {
            newOriginals[it.id] = { posX: it.posX, posY: it.posY };
          }
        });
        return newOriginals;
      });
      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          posX: snapToGridPoint(it.posX),
          posY: snapToGridPoint(it.posY),
        }))
      );
    } else {
      setItems((prev) =>
        prev.map((it) => {
          const original = originalPositions[it.id];
          return original ? { ...it, posX: original.posX, posY: original.posY } : it;
        })
      );
    }
  }, [snapToGrid, setItems]);

  // Header info change
  useEffect(() => {
    if (onHeaderInfoChange) {
      // The length the sheet prints at — see `sheetContentLengthIn` for why this
      // no longer has arithmetic of its own.
      const usedHeightIn =
        items.length > 0 ? sheetContentLengthIn(items, canvasWidth, marginSize, spacing) : 0;

      // Pricing is based on actual utilized area (not hardcoded).
      /*
       * Billed on the roll, with a minimum run length — the same rule the
       * server charges by. This priced `usedWidthIn * usedHeightIn`, the
       * bounding box of the artwork, so a sparse sheet was quoted a fraction of
       * what it would actually cost and a short one ignored the minimum.
       */
      const billed = billableSheetDimensions(usedHeightIn);
      /*
       * Zero only while the board is genuinely empty — there is nothing to
       * charge for yet. The dimensions still show the floor, so the strip reads
       * as "this is what a sheet costs" rather than "this sheet costs nothing".
       */
      const hasArtwork = items.length > 0;
      const totalAreaSf = hasArtwork ? billed.areaSf : 0;
      const totalPrice = +(totalAreaSf * pricePerSqFt).toFixed(
        UNIT.INCH.DECIMALS,
      );

      // Collect all image names
      const imageNames = items.map(item =>
        (item.name || `Item #${item.id}`).replace(/\.[^/.]+$/, "")
      );

      /*
       * "Instant hot peel" was hard-coded here. Nothing backed it: the store has
       * no film selection, the order model records no peel type, and it sat in
       * the slot that becomes the design's name once saved — so one position
       * meant a product claim before saving and a name after.
       */
      const displayName = 'Untitled gang sheet';

      onHeaderInfoChange({
        hasItem: items.length > 0,
        areaSf: totalAreaSf,
        // The billed dimensions, so the strip, the price and the invoice agree.
        widthIn: +billed.widthIn.toFixed(UNIT.INCH.DECIMALS),
        heightIn: +billed.heightIn.toFixed(UNIT.INCH.DECIMALS),
        minimumAreaSf: billableSheetDimensions(0).areaSf,
        // What the artwork actually occupies, kept for the layout warnings.
        usedHeightIn: +usedHeightIn.toFixed(UNIT.INCH.DECIMALS),
        atMinimumLength: hasArtwork && billed.atMinimum,
        isEmpty: !hasArtwork,
        name: displayName,
        price: totalPrice,
        imageNames,
        // Shared with the on-sheet highlight, so the chip's number and the
        // artwork it lights up can never disagree.
        lowDpiCount: items.filter(isLowDpi).length,
        unknownDpiCount: items.filter(isUnknownDpi).length,
      });
    }
  }, [items, canvasWidth, marginSize, spacing, onHeaderInfoChange, pricingSettings]);
};
