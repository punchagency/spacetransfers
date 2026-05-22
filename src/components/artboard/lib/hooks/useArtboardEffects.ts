import { useEffect, useState, useRef } from "react";
import { ArtboardItem } from "../../types";
import { animateItemPosition } from "../utils";
import { calculateGridLayout, getRenderedGroupSize } from "../utils";
import { snapToGridPoint } from "../utils";
import { CANVAS, PRICING, UNIT } from "../../../../config/artboard.config";
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
  showRulers: boolean,
  onHeaderInfoChange?: (info: any) => void,
  initialData?: any,
  onDataChange?: (data: any) => void,
  counter?: number
) => {
  const [originalPositions, setOriginalPositions] = useState<
    Record<number, { posX: number; posY: number }>
  >({});
  const [lastConfig, setLastConfig] = useState({ marginSize, spacing });
  const prevItemsRef = useRef<ArtboardItem[]>([]);
  const warnedMaxHeightRef = useRef(false);

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

  // Gravity layout and Auto Nesting
  useEffect(() => {
    const hasGravity = items.some((it) => it.gravityActive);
    const configChanged = lastConfig.marginSize !== marginSize || lastConfig.spacing !== spacing;
    const isAnyItemDropping = items.some(it => it.isDropping);

    if (canvasWidth === 0 || isAnyItemDropping || (!autoNestStickers && !hasGravity && !configChanged)) {
      prevItemsRef.current = items;
      return;
    }

    if (configChanged) {
      setLastConfig({ marginSize, spacing });
    }

    // Layout is now relative to ruler "0" (which is the container origin)
    const effectiveMargin = marginSize;

    const updates = calculateGridLayout(
      items,
      canvasWidth,
      spacing,
      autoNestStickers,
      effectiveMargin,
    );

    // Enforce max sheet height (100 feet = 1200 inches).
    // Use the actual rendered group height (multi-column aware) to avoid false positives.
    const MAX_SHEET_HEIGHT_IN = 1200;
    let didClamp = false;
    const effectiveMarginForClamp = marginSize;
    const maxAvailableWidthForClamp = Math.max(0, canvasWidth - 2 * effectiveMarginForClamp);
    const clampedUpdates = updates.map((u: any) => {
      const copies = typeof u.copies === "number" && u.copies > 0 ? u.copies : 1;
      const { height: actualGroupH } = getRenderedGroupSize(
        typeof u.widthIn === "number" ? u.widthIn : 0,
        typeof u.heightIn === "number" ? u.heightIn : 0,
        copies,
        maxAvailableWidthForClamp,
      );
      const maxPosY = Math.max(0, MAX_SHEET_HEIGHT_IN - actualGroupH);
      const nextPosY = Math.max(0, Math.min(u.posY, maxPosY));
      if (nextPosY < u.posY - 0.001) didClamp = true;
      return { ...u, posY: nextPosY };
    });

    if (didClamp && !warnedMaxHeightRef.current) {
      toast.error("Max sheet height of 1200 inches reached.");
      warnedMaxHeightRef.current = true;
    }

    const updatesToUse = clampedUpdates;

    setItems((prev) => {
      const needsUpdate = prev.some(it => {
        const update = updatesToUse.find((u) => u.id === it.id);
        if (!update) return false;
        return Math.abs(update.posX - it.posX) > 0.001 || Math.abs(update.posY - it.posY) > 0.001;
      });

      if (!needsUpdate && !configChanged) return prev;

      return prev.map((it) => {
        const update = updatesToUse.find((u: any) => u.id === it.id);
        if (update) {
          const hasMoved = Math.abs(update.posX - it.posX) > 0.001 || Math.abs(update.posY - it.posY) > 0.001;

          const isBeingDragged = isDraggingItem && it.id === selectedId;
          const shouldFollowLayout = !isBeingDragged && (autoNestStickers || it.gravityActive || configChanged);

          if (!shouldFollowLayout) {
            // If order changed but we shouldn't follow layout yet (dragging), 
            // we still need to preserve the gravityActive flag if it's set elsewhere
            return it;
          }

          return {
            ...it,
            posX: update.posX,
            posY: update.posY,
            // When a copies change triggered this reflow, suppress animation and clear the flag.
            gravityActive: it.skipAnimation ? false : hasMoved,
            skipAnimation: false,
          };
        }
        return it;
      });
    });
  }, [items, canvasWidth, autoNestStickers, spacing, marginSize, lastConfig, setItems, isDraggingItem, selectedId]);

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
      const MAX_SHEET_HEIGHT_IN = 1200;
      const bounds = items.reduce(
        (acc, item) => {
          const copies = item.copies || 1;
          const gap = CANVAS.GRID_GAP_IN;
          const effectiveMargin = marginSize;
          const maxAvailableWidth = Math.max(0, canvasWidth - 2 * effectiveMargin);

          const scaledWidth = item.widthIn;
          const scaledHeight = item.heightIn;
          const capacityCols = Math.max(
            1,
            Math.floor((maxAvailableWidth + gap) / (scaledWidth + gap)),
          );
          const visibleCols = Math.min(copies, capacityCols);
          const rows = Math.ceil(copies / capacityCols);

          const groupWidthRaw =
            visibleCols * scaledWidth + (visibleCols - 1) * gap;
          const maxGroupWidth = Math.max(0, maxAvailableWidth);
          const groupWidth = Math.min(groupWidthRaw, maxGroupWidth);

          const groupHeight =
            rows * scaledHeight + (rows - 1) * gap;

          const centeredLeft =
            effectiveMargin + (maxAvailableWidth - groupWidth) / 2;
          const rightBoundLeft = canvasWidth - effectiveMargin - groupWidth;
          const clampedLeft =
            copies > 1
              ? Math.max(
                  effectiveMargin,
                  Math.min(centeredLeft, rightBoundLeft),
                )
              : Math.max(effectiveMargin, item.posX);
          const maxTopBySheetLimit = Math.max(
            0,
            MAX_SHEET_HEIGHT_IN - groupHeight,
          );
          const clampedTop = Math.min(
            Math.max(effectiveMargin, item.posY),
            maxTopBySheetLimit,
          );

          const left = clampedLeft;
          const top = clampedTop;
          const right = clampedLeft + groupWidth;
          const bottom = clampedTop + groupHeight;
          return {
            minX: Math.min(acc.minX, left),
            minY: Math.min(acc.minY, top),
            maxX: Math.max(acc.maxX, right),
            maxY: Math.max(acc.maxY, bottom),
          };
        },
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: 0, maxY: 0 },
      );

      const usedWidthIn = items.length > 0 ? Math.max(0, bounds.maxX) : 0;
      const usedHeightIn = items.length > 0 ? Math.min(MAX_SHEET_HEIGHT_IN, Math.max(0, bounds.maxY)) : 0;

      // Pricing is based on actual utilized area (not hardcoded).
      const totalAreaSf = +(
        (usedWidthIn * usedHeightIn) /
        PRICING.SQUARE_INCHES_PER_SQ_FT
      ).toFixed(UNIT.INCH.DECIMALS);
      const totalPrice = +(totalAreaSf * PRICING.PRICE_PER_SQ_FT).toFixed(
        UNIT.INCH.DECIMALS,
      );

      // Collect all image names
      const imageNames = items.map(item =>
        (item.name || `Item #${item.id}`).replace(/\.[^/.]+$/, "")
      );

      // Default to "Instant hot peel" and do not change when items are selected
      const displayName = 'Instant hot peel';

      onHeaderInfoChange({
        hasItem: items.length > 0,
        areaSf: totalAreaSf,
        widthIn: +usedWidthIn.toFixed(UNIT.INCH.DECIMALS),
        heightIn: +usedHeightIn.toFixed(UNIT.INCH.DECIMALS),
        name: displayName,
        price: totalPrice,
        imageNames,
      });
    }
  }, [items, canvasWidth, marginSize, onHeaderInfoChange]);
};
