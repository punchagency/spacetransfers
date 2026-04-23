import React, { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { FiLink } from "react-icons/fi";
import ItemToolbar from "./ItemToolbar";
import PropertiesPanel from "./PropertiesPanel";
import { gsap } from "gsap";
import { CANVAS } from "../../../../config/artboard.config";

let hasShownMaxHeightToast = false;

interface ArtboardItemProps {
  item: {
    id: number;
    url: string;
    rotation: number;
    locked: boolean;
    expanded: boolean;
    flipped: boolean;
    widthIn: number;
    heightIn: number;
    posX: number;
    posY: number;
    name?: string;
    price: number;
    autoCrop: boolean;
    copies: number;
    linked: boolean;
  };
  isSelected: boolean;
  showProperties: boolean;
  addedToCart: boolean;
  onSelect: (multi?: boolean) => void;
  onToggleProperties: () => void;
  onLink: () => void;
  onRotate: () => void;
  onToggleLock: () => void;
  onFlip: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleAutoCrop: () => void;
  onSetCopies: (n: number) => void;
  onToggleLinked: () => void;
  onSetWidthIn: (n: number) => void;
  onSetHeightIn: (n: number) => void;
  onSetPosX: (n: number) => void;
  onSetPosY: (n: number) => void;
  onAddToCart: () => void;
  onCloseProperties: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  isDragging: boolean;
  canvasWidth: number;
  marginSize: number;
}

export default function ArtboardItem({
  item,
  isSelected,
  showProperties,
  addedToCart,
  onSelect,
  onToggleProperties,
  onLink,
  onRotate,
  onToggleLock,
  onFlip,
  onDuplicate,
  onDelete,
  onToggleAutoCrop,
  onSetCopies,
  onToggleLinked,
  onSetWidthIn,
  onSetHeightIn,
  onSetPosX,
  onSetPosY,
  onAddToCart,
  onCloseProperties,
  onDragStart,
  onResizeStart,
  isDragging,
  canvasWidth,
  marginSize,
}: ArtboardItemProps) {
  const panelWidth = 2.625;
  const effectiveMargin = marginSize;
  const MAX_SHEET_HEIGHT_IN = 1200;
  const isTooCloseToRight =
    item.posX + item.widthIn + panelWidth > canvasWidth - effectiveMargin;
  const gap = CANVAS.GRID_GAP_IN;
  const aspectRatio = item.heightIn / item.widthIn;
  const maxAvailableWidth = canvasWidth - 2 * effectiveMargin;
  const scaledWidth = item.widthIn;
  const scaledHeight = scaledWidth * aspectRatio;
  const capacityCols = Math.max(
    1,
    Math.floor((maxAvailableWidth + gap) / (scaledWidth + gap))
  );

  // To guarantee items never exceed the sheet height limit,
  // we cap the *rendered* copies to what can fit vertically.
  const maxGroupHeightAllowedIn = Math.max(0, MAX_SHEET_HEIGHT_IN - effectiveMargin);
  const maxRows = Math.max(
    1,
    Math.floor((maxGroupHeightAllowedIn + gap) / Math.max(1e-6, scaledHeight + gap)),
  );

  const visibleColsCandidate = Math.max(1, Math.min(item.copies, capacityCols));
  const maxCopiesThatFit = Math.max(1, maxRows * visibleColsCandidate);
  const renderCopies = Math.max(1, Math.min(item.copies, maxCopiesThatFit));

  const visibleCols = Math.max(1, Math.min(renderCopies, capacityCols));
  const rows = Math.max(1, Math.ceil(renderCopies / visibleCols));

  const groupWidthInchesRaw =
    visibleCols * scaledWidth + (visibleCols - 1) * gap;
  const groupHeightInches = rows * scaledHeight + (rows - 1) * gap;

  const maxGroupWidthInches = Math.max(
    0,
    maxAvailableWidth
  );
  const groupWidthInches = Math.min(groupWidthInchesRaw, maxGroupWidthInches);
  const centeredLeftInches =
    effectiveMargin + (maxAvailableWidth - groupWidthInches) / 2;
  const rightBoundLeftInches = canvasWidth - effectiveMargin - groupWidthInches;
  const clampedLeft =
    renderCopies > 1
      ? Math.max(
          effectiveMargin,
          Math.min(centeredLeftInches, rightBoundLeftInches)
        )
      : Math.max(effectiveMargin, item.posX);
  // Clamp by sheet height only (bottom must not exceed MAX_SHEET_HEIGHT_IN).
  // If the item is taller than the remaining space, we allow `clampedTop` to move
  // above `effectiveMargin` rather than letting the item overflow.
  const topRaw = item.posY;
  const bottomLimitTopInches = MAX_SHEET_HEIGHT_IN - groupHeightInches;
  const clampedTop = Math.min(topRaw, bottomLimitTopInches);

  const firstRowFilled = renderCopies >= capacityCols;
  const propertyPanelPosition = firstRowFilled
    ? "center"
    : isTooCloseToRight
    ? "left"
    : "right";

  const groupWidthPx = groupWidthInches * CANVAS.PIXELS_PER_INCH;
  const prevCopiesRef = useRef<number>(item.copies);

  // Notify once if we had to cap/render fewer copies or clamp the item into the max height.
  const didCapCopies = renderCopies < item.copies;
  const didClampTop = clampedTop < topRaw - 1e-6;
  useEffect(() => {
    if (!hasShownMaxHeightToast && (didCapCopies || didClampTop)) {
      toast.error("Max sheet height of 1200 inches reached.");
      hasShownMaxHeightToast = true;
    }
  }, [didCapCopies, didClampTop]);

  useEffect(() => {
    if (prevCopiesRef.current === 1 && item.copies > 1) {
      const element = document.querySelector(
        `[data-item-id="${item.id}"]`
      ) as HTMLElement;
      if (element) {
        const baseLeftInches = Math.max(effectiveMargin, item.posX);
        const deltaPx = (clampedLeft - baseLeftInches) * CANVAS.PIXELS_PER_INCH;
        gsap.fromTo(
          element,
          { x: -deltaPx },
          { x: 0, duration: 0.8, ease: "power2.out" }
        );
      }
    }
    prevCopiesRef.current = item.copies;
  }, [item.copies, clampedLeft, effectiveMargin, item.posX, item.id]);

  return (
    <div
      data-item-id={item.id}
      className={`absolute rounded-md transition-all duration-300 ease-out ${
        isSelected ? "ring-4 ring-blue-500" : ""
      }`}
      style={{
        left: `${clampedLeft * CANVAS.PIXELS_PER_INCH}px`,
        top: `${clampedTop * CANVAS.PIXELS_PER_INCH}px`,
        touchAction: "none",
        zIndex: isSelected ? 1000 : item.copies > 1 ? 30 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isSelected && !showProperties && !e.shiftKey) {
          onToggleProperties();
        } else {
          onSelect(e.shiftKey);
        }
      }}
    >
      {isSelected && (
        <ItemToolbar
          locked={item.locked}
          onLink={onLink}
          onRotate={onRotate}
          onToggleLock={onToggleLock}
          onFlip={onFlip}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          position={clampedTop <= marginSize + 0.3 ? "bottom" : "top"}
        />
      )}
      {isSelected ? (
        <div className="absolute top-1 right-2 bg-white/90 border border-gray-200 text-gray-700 text-[10px] rounded-full px-2 h-5 flex items-center gap-2 pointer-events-none">
          <span className="font-semibold">{item.copies > 1 ? "Group" : "Single"}</span>
          <span className="text-gray-400">•</span>
          <span>{item.copies > 1 ? "Top" : "Bottom"}</span>
        </div>
      ) : null}
      {isSelected && showProperties && !isDragging && (
        <PropertiesPanel
          item={item}
          addedToCart={addedToCart}
          onClose={onCloseProperties}
          onToggleAutoCrop={onToggleAutoCrop}
          onSetCopies={onSetCopies}
          onToggleLinked={onToggleLinked}
          onSetWidthIn={onSetWidthIn}
          onSetHeightIn={onSetHeightIn}
          onSetPosX={onSetPosX}
          onSetPosY={onSetPosY}
          onAddToCart={onAddToCart}
          position={propertyPanelPosition}
        />
      )}
      {isSelected && !item.autoCrop && (
        <div
          className="absolute top-1 left-2 bg-blue-600 text-white text-xs rounded-xl px-2 h-5 flex items-center gap-1 cursor-pointer hover:bg-blue-700 pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLinked();
          }}
        >
          <FiLink className="w-3 h-3" />
          <span>#{item.id}</span>
        </div>
      )}
      {/* Group Layout for Copies */}
      <div
        className="flex flex-wrap justify-start transition-all duration-300 ease-out"
        style={{ gap: `${gap * CANVAS.PIXELS_PER_INCH}px`, width: `${groupWidthPx}px` }}
      >
        {Array.from({ length: renderCopies }).map((_, index) => (
          <img
            key={index}
            src={item.url}
            crossOrigin="anonymous"
            alt={`copy-${index}`}
            className={`object-contain cursor-move transition-all duration-300 ease-out rounded-sm ${
              isSelected && renderCopies > 1 ? "border border-blue-500" : ""
            }`}
            style={{
              width: `${scaledWidth * CANVAS.PIXELS_PER_INCH}px`,
              height: `${scaledHeight * CANVAS.PIXELS_PER_INCH}px`,
              transform: `scaleX(${item.flipped ? -1 : 1}) rotate(${
                item.rotation
              }deg)`,
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onDragStart(e);
            }}
          />
        ))}
      </div>
      {isSelected && (
        <>
          <span
            className="absolute -top-2 -left-2 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white cursor-nwse-resize"
            onMouseDown={onResizeStart}
          />
          <span
            className="absolute -top-2 -right-2 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white cursor-nesw-resize"
            onMouseDown={onResizeStart}
          />
          <span
            className="absolute -bottom-2 -left-2 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white cursor-nesw-resize"
            onMouseDown={onResizeStart}
          />
          <span
            className="absolute -bottom-2 -right-2 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white cursor-nwse-resize"
            onMouseDown={onResizeStart}
          />
        </>
      )}
    </div>
  );
}
