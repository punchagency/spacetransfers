import React, { useEffect, useRef } from "react";
import { FiLink } from "react-icons/fi";
import ItemToolbar from "./ItemToolbar";
import PropertiesPanel from "./PropertiesPanel";
import { gsap } from "gsap";

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
  const offsetInches = 20 / 96;
  const effectiveMargin = marginSize + offsetInches;
  const isTooCloseToRight =
    item.posX + item.widthIn + panelWidth > canvasWidth - effectiveMargin;
  const gap = 0.06;
  const aspectRatio = item.heightIn / item.widthIn;
  const maxAvailableWidth = canvasWidth - 2 * effectiveMargin;
  const scaledWidth = item.widthIn;
  const scaledHeight = scaledWidth * aspectRatio;
  const capacityCols = Math.max(
    1,
    Math.floor((maxAvailableWidth + gap) / (scaledWidth + gap))
  );
  const visibleCols = Math.min(item.copies, capacityCols);
  const selectionBufferIn = 0.084;
  const groupWidthInchesRaw =
    visibleCols * scaledWidth + (visibleCols - 1) * gap + selectionBufferIn;
  const maxGroupWidthInches = Math.max(
    0,
    maxAvailableWidth - selectionBufferIn
  );
  const groupWidthInches = Math.min(groupWidthInchesRaw, maxGroupWidthInches);
  const centeredLeftInches =
    effectiveMargin + (maxAvailableWidth - groupWidthInches) / 2;
  const rightBoundLeftInches = canvasWidth - effectiveMargin - groupWidthInches;
  const clampedLeft =
    item.copies > 1
      ? Math.max(
          effectiveMargin,
          Math.min(centeredLeftInches, rightBoundLeftInches)
        )
      : Math.max(effectiveMargin, item.posX);
  const clampedTop = Math.max(effectiveMargin, item.posY);
  const firstRowFilled = item.copies >= capacityCols;
  const propertyPanelPosition = firstRowFilled
    ? "center"
    : isTooCloseToRight
    ? "left"
    : "right";

  const groupWidthPx = groupWidthInches * 96;
  const prevCopiesRef = useRef<number>(item.copies);

  useEffect(() => {
    if (prevCopiesRef.current === 1 && item.copies > 1) {
      const element = document.querySelector(
        `[data-item-id="${item.id}"]`
      ) as HTMLElement;
      if (element) {
        const baseLeftInches = Math.max(effectiveMargin, item.posX);
        const deltaPx = (clampedLeft - baseLeftInches) * 96;
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
        isSelected ? "ring-4 ring-blue-500 z-40" : "z-10"
      }`}
      style={{
        left: `${clampedLeft * 96}px`,
        top: `${clampedTop * 96}px`,
        touchAction: "none",
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
          position={item.posY <= marginSize + 0.3 ? "bottom" : "top"}
        />
      )}
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
        className="flex flex-wrap justify-center transition-all duration-300 ease-out"
        style={{ gap: `${gap * 96}px`, width: `${groupWidthPx}px` }}
      >
        {Array.from({ length: item.copies }).map((_, index) => (
          <img
            key={index}
            src={item.url}
            crossOrigin="anonymous"
            alt={`copy-${index}`}
            className={`object-contain cursor-move transition-all duration-300 ease-out rounded-sm ${
              isSelected && item.copies > 1 ? "border border-blue-500" : ""
            }`}
            style={{
              width: `${scaledWidth * 96}px`,
              height: `${scaledHeight * 96}px`,
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
