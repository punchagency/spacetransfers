import { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ArtboardItem } from "../../types";
import { CANVAS } from "../../../../config/artboard.config";
import toast from "react-hot-toast";
import { getRenderedBounds } from "../utils";
import type { CommitHistory } from "./useHistory";

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
) => {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [isDraggingItem, setIsDraggingItem] = useState(false); 
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    posX: number;
    posY: number;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  
  } | null>(null);

  const MAX_SHEET_HEIGHT_IN = 1200;
  const warnedMaxHeightRef = useRef(false);
  const warnedMaxWidthRef = useRef(false);
  const autoNestWasActiveRef = useRef(false);
  const MAX_WIDTH_ERROR = "Image width cannot exceed the printable area of the film after margins are applied.";

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

  const getMinSpacingIn = () => {
    const tightGapIn = 2 / 96;
    return autoNestStickers
      ? Math.min(Math.max(spacing, 0), tightGapIn)
      : Math.max(spacing, 0.08);
  };

  const resolveCollisionPosY = (all: ArtboardItem[], candidate: ArtboardItem) => {
    const minSpacingIn = getMinSpacingIn();
    const clearance = minSpacingIn + CANVAS.SELECTION_BUFFER_IN;
    const others = all.filter((it) => it.id !== candidate.id);

    const maxIterations = 40;
    let y = candidate.posY;

    for (let i = 0; i < maxIterations; i++) {
      const candBounds = getRenderedBounds({ ...candidate, posY: y }, canvasWidth, marginSize);
      let nextY: number | null = null;

      for (const it of others) {
        const b = getRenderedBounds(it, canvasWidth, marginSize);
        const overlaps =
          candBounds.left < b.right + clearance &&
          candBounds.right + clearance > b.left &&
          candBounds.top < b.bottom + clearance &&
          candBounds.bottom + clearance > b.top;

        if (overlaps) {
          nextY = Math.max(nextY ?? 0, b.bottom + clearance);
        }
      }

      if (nextY == null) return y;
      y = nextY;
      if (y > MAX_SHEET_HEIGHT_IN) break;
    }

    return y;
  };

  const handleResizeStart = (e: React.MouseEvent, itemId: number) => {
    e.stopPropagation();
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    commitHistory?.();
    if (autoNestStickers) {
      autoNestWasActiveRef.current = true;
      onRequestAutoNest?.(false);
    }
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: item.widthIn,
      height: item.heightIn,
    });
  };

  const handleDragStart = (e: React.MouseEvent, itemId: number) => {
    const item = items.find((it) => it.id === itemId);
    if (!item || item.locked) return;
    commitHistory?.();
    const el = document.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement | null;
    if (el) gsap.killTweensOf(el);
    if (item.isDropping) {
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, isDropping: false } : it))
      );
    }
    setIsDraggingItem(true);
    setDragStart({ x: e.clientX, y: e.clientY, posX: item.posX, posY: item.posY });
  };

  useEffect(() => {
    if (!isResizing || !resizeStart || selectedId == null) return;

    const handleMouseMove = (e: MouseEvent) => {
      setItems((prevItems) => {
        const item = prevItems.find((it) => it.id === selectedId);
        if (!item) return prevItems;

        const deltaX = (e.clientX - resizeStart.x) / (CANVAS.PIXELS_PER_INCH * zoom);
        const deltaY = (e.clientY - resizeStart.y) / (CANVAS.PIXELS_PER_INCH * zoom);
        const newWidth = Math.max(0.01, resizeStart.width + deltaX);
        const newHeight = Math.max(0.01, resizeStart.height + deltaY);

        if (item.linked) {
          const ratio = resizeStart.height / resizeStart.width;
          const avgDelta = (deltaX + deltaY / ratio) / 2;
          const rawWidth = Math.max(0.5, resizeStart.width + avgDelta);

          const maxPrintableWidth = (canvasWidth || CANVAS.SHEET_WIDTH_IN) - 2 * marginSize;
          const widthAfterWidthClamp = Math.min(rawWidth, maxPrintableWidth);
          if (widthAfterWidthClamp < rawWidth && !warnedMaxWidthRef.current) {
            toast.error(MAX_WIDTH_ERROR);
            warnedMaxWidthRef.current = true;
          }

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
            it.id === selectedId
              ? {
                  ...it,
                  widthIn: clampedWidth,
                  heightIn: clampedHeight,
                  posY: Math.min(it.posY, maxPosY),
                }
              : it,
          );
        } else {
          const maxPrintableWidth = (canvasWidth || CANVAS.SHEET_WIDTH_IN) - 2 * marginSize;
          const clampedWidth = Math.min(newWidth, maxPrintableWidth);
          if (clampedWidth < newWidth && !warnedMaxWidthRef.current) {
            toast.error(MAX_WIDTH_ERROR);
            warnedMaxWidthRef.current = true;
          }

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
            it.id === selectedId
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

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeStart(null);
      warnedMaxWidthRef.current = false;
      if (autoNestWasActiveRef.current) {
        autoNestWasActiveRef.current = false;
        onRequestAutoNest?.(true);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, resizeStart, selectedId, items, zoom, setItems, canvasWidth, marginSize, spacing, autoNestStickers]);

  useEffect(() => {
    if (!isDraggingItem || !dragStart || selectedId == null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = (e.clientX - dragStart.x) / (CANVAS.PIXELS_PER_INCH * zoom);
      const deltaY = (e.clientY - dragStart.y) / (CANVAS.PIXELS_PER_INCH * zoom);
      const newPosX = dragStart.posX + deltaX;
      const newPosY = dragStart.posY + deltaY;

      setItems((prev) => {
        if (autoNestStickers) {
            const others = prev.filter(it => it.id !== selectedId);
            const dragged = prev.find(it => it.id === selectedId);
            if (!dragged) return prev;

            const groupHeightWorstIn = getGroupHeightWorstIn({
              heightIn: dragged.heightIn,
              copies: dragged.copies,
            });
            const maxPosY = Math.max(
              0,
              MAX_SHEET_HEIGHT_IN - groupHeightWorstIn,
            );
            const clampedNewPosY = Math.max(0, Math.min(newPosY, maxPosY));
            if (clampedNewPosY !== newPosY && !warnedMaxHeightRef.current) {
              maybeToastMaxHeight();
            }

            // Find the best new index based on center-point proximity
            let targetIndex = 0;
            let minDistance = Infinity;

            others.forEach((it, idx) => {
              const dist = Math.sqrt(
                Math.pow(it.posX + it.widthIn / 2 - (newPosX + dragged.widthIn / 2), 2) +
                Math.pow(it.posY + it.heightIn / 2 - (newPosY + dragged.heightIn / 2), 2)
              );

              if (dist < minDistance) {
                minDistance = dist;
                // If mouse center is more towards the right of this item's center, it goes after
                targetIndex = (newPosX + dragged.widthIn / 2) > (it.posX + it.widthIn / 2) ? idx + 1 : idx;
              }
            });

            const oldIndex = prev.findIndex(it => it.id === selectedId);
            if (oldIndex === targetIndex) {
              return prev.map(it => it.id === selectedId ? { ...it, posX: newPosX, posY: clampedNewPosY } : it);
            }

            // Order changed! Create new array order
            const newItems = [...others];
            newItems.splice(targetIndex, 0, { ...dragged, posX: newPosX, posY: clampedNewPosY, gravityActive: false });

            return newItems.map((it, idx) => {
              const indexChanged = idx !== prev.findIndex(p => p.id === it.id);
              return {
                ...it,
                gravityActive: it.id !== selectedId && indexChanged
              };
            });
        } else {
          const finalX = snapToGrid ? snapToGridPoint(newPosX) : newPosX;
          const dragged = prev.find((it) => it.id === selectedId);
          const maxPosY = dragged
            ? Math.max(
                0,
                MAX_SHEET_HEIGHT_IN -
                  getGroupHeightWorstIn({
                    heightIn: dragged.heightIn,
                    copies: dragged.copies,
                  }),
              )
            : MAX_SHEET_HEIGHT_IN;
          const rawFinalY = snapToGrid ? snapToGridPoint(newPosY) : newPosY;
          const finalY = Math.max(0, Math.min(rawFinalY, maxPosY));
          if (finalY !== rawFinalY && !warnedMaxHeightRef.current) {
            maybeToastMaxHeight();
          }
          const updated = prev.map((it) =>
            it.id === selectedId ? { ...it, posX: finalX, posY: finalY } : it
          );
          const nextItem = updated.find((it) => it.id === selectedId);
          if (!nextItem) return updated;
          const resolvedY = resolveCollisionPosY(updated, nextItem);
          return updated.map((it) =>
            it.id === selectedId ? { ...it, posY: Math.min(resolvedY, maxPosY) } : it
          );
        }
      });
    };

    const handleMouseUp = () => {
      setIsDraggingItem(false);
      setDragStart(null);
      // Clear gravityActive so the layout effect doesn't snap the item back after release
      if (selectedId != null) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === selectedId ? { ...it, gravityActive: false } : it
          )
        );
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingItem, dragStart, selectedId, zoom, snapToGrid, snapToGridPoint, setItems, canvasWidth, marginSize, spacing, autoNestStickers]);

  return {
    handleResizeStart,
    handleDragStart,
    isDraggingItem,
    isResizing,
  };
};
