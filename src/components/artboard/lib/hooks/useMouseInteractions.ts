import { useState, useEffect } from "react";
import { ArtboardItem } from "../../types";
import { CANVAS } from "../../../../config/artboard.config";

export const useMouseInteractions = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  selectedId: number | null,
  zoom: number,
  snapToGrid: boolean,
  snapToGridPoint: (value: number) => number,
  autoNestStickers: boolean
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

  const handleResizeStart = (e: React.MouseEvent, itemId: number) => {
    e.stopPropagation();
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
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
        const newWidth = Math.max(0.5, resizeStart.width + deltaX);
        const newHeight = Math.max(0.5, resizeStart.height + deltaY);

        if (item.linked) {
          const ratio = resizeStart.height / resizeStart.width;
          const avgDelta = (deltaX + deltaY / ratio) / 2;
          const finalWidth = Math.max(0.5, resizeStart.width + avgDelta);
          const finalHeight = finalWidth * ratio;
          return prevItems.map((it) =>
            it.id === selectedId
              ? { ...it, widthIn: finalWidth, heightIn: finalHeight }
              : it
          );
        } else {
          return prevItems.map((it) =>
            it.id === selectedId ? { ...it, widthIn: newWidth, heightIn: newHeight } : it
          );
        }
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeStart(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, resizeStart, selectedId, items, zoom, setItems]);

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
              return prev.map(it => it.id === selectedId ? { ...it, posX: newPosX, posY: newPosY } : it);
            }

            // Order changed! Create new array order
            const newItems = [...others];
            newItems.splice(targetIndex, 0, { ...dragged, posX: newPosX, posY: newPosY, gravityActive: false });

            return newItems.map((it, idx) => {
              const indexChanged = idx !== prev.findIndex(p => p.id === it.id);
              return {
                ...it,
                gravityActive: it.id !== selectedId && indexChanged
              };
            });
        } else {
          const finalX = snapToGrid ? snapToGridPoint(newPosX) : newPosX;
          const finalY = snapToGrid ? snapToGridPoint(newPosY) : newPosY;
          return prev.map((it) =>
            it.id === selectedId ? { ...it, posX: finalX, posY: finalY } : it
          );
        }
      });
    };

    const handleMouseUp = () => {
      setIsDraggingItem(false);
      setDragStart(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingItem, dragStart, selectedId, zoom, snapToGrid, snapToGridPoint, setItems]);

  return {
    handleResizeStart,
    handleDragStart,
    isDraggingItem,
  };
};
