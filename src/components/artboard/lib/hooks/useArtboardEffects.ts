import { useEffect, useState, useRef } from "react";
import { ArtboardItem } from "../../types";
import { animateItemPosition } from "../utils";
import { calculateGridLayout } from "../utils";
import { snapToGridPoint } from "../utils";

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


  // Animate items only when gravity is active
  useEffect(() => {
    items.forEach((it) => {
      if (!it.gravityActive) return;

      const element = document.querySelector(
        `[data-item-id="${it.id}"]`
      ) as HTMLElement;
      if (!element) return;

      const prevItem = prevItemsRef.current.find(p => p.id === it.id);
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

    // Add fixed 20px offset to match CanvasMargins visual position
    const offsetInches = 20 / 96;
    const effectiveMargin = marginSize + offsetInches;

    const updates = calculateGridLayout(items, canvasWidth, spacing, autoNestStickers, effectiveMargin);

    setItems((prev) => {
      const needsUpdate = prev.some(it => {
        const update = updates.find((u) => u.id === it.id);
        if (!update) return false;
        return Math.abs(update.posX - it.posX) > 0.001 || Math.abs(update.posY - it.posY) > 0.001;
      });

      if (!needsUpdate && !configChanged) return prev;

      return prev.map((it) => {
        const update = updates.find((u: any) => u.id === it.id);
        if (update) {
          const hasMoved = Math.abs(update.posX - it.posX) > 0.001 || Math.abs(update.posY - it.posY) > 0.001;

          const isBeingDragged = isDraggingItem && it.id === selectedId;
          const shouldFollowLayout = !isBeingDragged && (autoNestStickers || it.gravityActive || configChanged);

          if (!shouldFollowLayout) {
            // If order changed but we shouldn't follow layout yet (dragging), 
            // we still need to preserve the gravityActive flag if it's set elsewhere
            return it;
          }

          return { ...it, posX: update.posX, posY: update.posY, gravityActive: hasMoved };
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
      // Use exact ruler dimensions
      // Top ruler: 24 inches
      // Left ruler: 19.5 inches (24 inches height - ruler offset)
      const gangSheetWidthIn = 24;
      const gangSheetHeightIn = 19.5;

      const areaSf = +((gangSheetWidthIn * gangSheetHeightIn) / 144).toFixed(2);

      // Calculate total price based on all items on the artboard
      const totalPrice = items.reduce((sum, item) => {
        const itemWidthIn = +item.widthIn.toFixed(2);
        const itemHeightIn = +item.heightIn.toFixed(2);
        const itemAreaSf = +((itemWidthIn * itemHeightIn) / 144).toFixed(2);
        const pricePerSqFt = 5.5;
        const itemPrice = +(itemAreaSf * pricePerSqFt * (item.copies || 1)).toFixed(2);
        return sum + itemPrice;
      }, 0);

      // Collect all image names
      const imageNames = items.map(item =>
        (item.name || `Item #${item.id}`).replace(/\.[^/.]+$/, "")
      );

      // Default to "Instant hot peel" and do not change when items are selected
      const displayName = 'Instant hot peel';

      onHeaderInfoChange({
        hasItem: items.length > 0,
        areaSf,
        widthIn: gangSheetWidthIn,
        heightIn: gangSheetHeightIn,
        name: displayName,
        price: totalPrice,
        imageNames,
      });
    }
  }, [items, selectedId, onHeaderInfoChange]);
};
