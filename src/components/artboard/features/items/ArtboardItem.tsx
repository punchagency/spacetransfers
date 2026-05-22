import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { FiLink } from "react-icons/fi";
import ItemToolbar from "./ItemToolbar";
import PropertiesPanel from "./PropertiesPanel";
import { CANVAS } from "../../../../config/artboard.config";
import { computeRenderCopies } from "../../lib/utils/layoutHelpers";

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
  isPrimary: boolean;
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
  onRemoveBg: (onProgress?: (phase: string, pct: number) => void) => Promise<void>;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  isDragging: boolean;
  canvasWidth: number;
  marginSize: number;
  spacing: number;
  zoom: number;
  scrollTop: number;
  viewportHeight: number;
}

export default function ArtboardItem({
  item,
  isSelected,
  isPrimary,
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
  onRemoveBg,
  onDragStart,
  onResizeStart,
  isDragging,
  canvasWidth,
  marginSize,
  spacing,
  zoom,
  scrollTop,
  viewportHeight,
}: ArtboardItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [bgStatus, setBgStatus] = useState<'detecting' | 'has-bg' | 'no-bg'>('detecting');
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [bgProgress, setBgProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [panelInitialPos, setPanelInitialPos] = useState({ x: 0, y: 0 });
  const itemRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragActivatedRef = useRef(false);
  const savedMouseRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

  // Compute viewport-relative position for the panel when it first opens
  useEffect(() => {
    if (!showProperties || !itemRef.current) return;
    const rect = itemRef.current.getBoundingClientRect();
    const panelWidth = 320; // w-80
    const panelEstimatedHeight = 420; // rough estimate; clamp will correct if needed
    const HEADER_PX = 40; // matches h-10 in Header.tsx
    const TOP_SAFE_PX = HEADER_PX + 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = rect.right + 12;
    if (x + panelWidth > vw - 8) {
      x = rect.left - panelWidth - 12;
    }
    if (x < 8) x = 8;
    let y = Math.max(TOP_SAFE_PX, rect.top);
    const maxY = Math.max(TOP_SAFE_PX, vh - panelEstimatedHeight - 8);
    if (y > maxY) y = maxY;
    setPanelInitialPos({ x, y });
  // Only recompute when the panel opens (showProperties flips to true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProperties]);

  // Detect whether the image has a solid background by sampling the 4 corners.
  // All-transparent corners → already no background → disable Remove BG.
  useEffect(() => {
    setBgStatus('detecting');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { setBgStatus('has-bg'); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const corners = [
          ctx.getImageData(0, 0, 1, 1).data[3],
          ctx.getImageData(size - 1, 0, 1, 1).data[3],
          ctx.getImageData(0, size - 1, 1, 1).data[3],
          ctx.getImageData(size - 1, size - 1, 1, 1).data[3],
        ];
        const avgAlpha = corners.reduce((s, a) => s + a, 0) / corners.length;
        setBgStatus(avgAlpha < 10 ? 'no-bg' : 'has-bg');
      } catch {
        setBgStatus('has-bg');
      }
    };
    img.onerror = () => setBgStatus('has-bg');
    img.src = item.url;
  }, [item.url]);

  const handleRemoveBg = async () => {
    setIsRemovingBg(true);
    setBgProgress({ phase: "Starting...", pct: 0 });
    try {
      await onRemoveBg((phase, pct) => setBgProgress({ phase, pct }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Background removal failed";
      toast.error(msg);
    } finally {
      setIsRemovingBg(false);
      setBgProgress(null);
    }
  };

  const effectiveMargin = marginSize;
  const MAX_SHEET_HEIGHT_IN = 1200;
  const gap = spacing;
  const maxAvailableWidth = canvasWidth - 2 * effectiveMargin;
  const scaledWidth = item.widthIn;
  const scaledHeight = item.heightIn;
  const capacityCols = Math.max(
    1,
    Math.floor((maxAvailableWidth + gap) / Math.max(1e-6, scaledWidth + gap))
  );

  const renderCopies = computeRenderCopies(item, canvasWidth, effectiveMargin, gap);

  const visibleCols = Math.max(1, Math.min(renderCopies, capacityCols));
  const rows = Math.max(1, Math.ceil(renderCopies / visibleCols));

  const groupWidthInchesRaw = visibleCols * scaledWidth + (visibleCols - 1) * gap;
  const groupHeightInches = rows * scaledHeight + (rows - 1) * gap;
  const groupWidthInches = Math.min(groupWidthInchesRaw, Math.max(0, maxAvailableWidth));
  const clampedLeft = Math.max(effectiveMargin, item.posX);
  const topRaw = item.posY;
  const bottomLimitTopInches = MAX_SHEET_HEIGHT_IN - groupHeightInches;
  const clampedTop = Math.min(topRaw, bottomLimitTopInches);

  const ppi = CANVAS.PIXELS_PER_INCH;
  const groupWidthPx = groupWidthInches * ppi;
  const totalGroupHeightPx = rows * scaledHeight * ppi + Math.max(0, rows - 1) * gap * ppi;

  // Virtual rendering: derive which rows fall inside the current scroll viewport.
  // Item positions inside the canvas div are in un-zoomed CSS pixels; after the
  // parent's scale(zoom) they appear at (pos * ppi * zoom) in scroll-container px.
  const baseVisualPx = clampedTop * ppi * zoom;
  const rowStridePx = (scaledHeight + gap) * ppi * zoom;
  const BUFFER_ROWS = 2;
  const firstVisibleRow = Math.max(
    0,
    Math.floor((scrollTop - baseVisualPx) / rowStridePx) - BUFFER_ROWS,
  );
  const lastVisibleRow = Math.min(
    rows - 1,
    Math.ceil((scrollTop + viewportHeight - baseVisualPx) / rowStridePx) + BUFFER_ROWS,
  );
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
    prevCopiesRef.current = item.copies;
  }, [item.copies]);

  const propertiesPortal =
    isSelected && showProperties && !isDragging
      ? (() => {
          const portal = document.body;
          return createPortal(
            <PropertiesPanel
              item={item}
              addedToCart={addedToCart}
              initialPos={panelInitialPos}
              onClose={onCloseProperties}
              onToggleAutoCrop={onToggleAutoCrop}
              onSetCopies={onSetCopies}
              onToggleLinked={onToggleLinked}
              onSetWidthIn={onSetWidthIn}
              onSetHeightIn={onSetHeightIn}
              onSetPosX={onSetPosX}
              onSetPosY={onSetPosY}
              onAddToCart={onAddToCart}
            />,
            portal,
          );
        })()
      : null;

  return (
    <div
      ref={itemRef}
      data-item-id={item.id}
      className={`absolute rounded-md transition-shadow duration-300 ease-out ${
        isSelected
          ? "ring-4 ring-blue-500"
          : isHovered
          ? "ring-4 ring-blue-400"
          : ""
      }`}
      style={{
        left: `${clampedLeft * CANVAS.PIXELS_PER_INCH}px`,
        top: `${clampedTop * CANVAS.PIXELS_PER_INCH}px`,
        touchAction: "none",
        zIndex: isSelected ? 1000 : item.copies > 1 ? 30 : 10,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); cancelLongPress(); }}
      onClick={(e) => {
        e.stopPropagation();
        if (dragActivatedRef.current) {
          dragActivatedRef.current = false;
          return;
        }
        if (e.shiftKey) {
          onSelect(true);
        } else {
          onSelect(false);
          onToggleProperties();
        }
      }}
    >
      {isPrimary && (() => {
        const portal = document.getElementById("artboard-toolbar-portal");
        if (!portal) return null;
        return createPortal(
          <ItemToolbar
            locked={item.locked}
            onLink={onLink}
            onRotate={onRotate}
            onToggleLock={onToggleLock}
            onFlip={onFlip}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onRemoveBg={handleRemoveBg}
            bgStatus={bgStatus}
            isRemovingBg={isRemovingBg}
            bgProgress={bgProgress}
          />,
          portal,
        );
      })()}
      {isSelected ? (
        <div className="absolute top-1 right-2 bg-white/90 border border-gray-200 text-gray-700 text-[10px] rounded-full px-2 h-5 flex items-center gap-2 pointer-events-none">
          <span className="font-semibold">{item.copies > 1 ? "Group" : "Single"}</span>
          <span className="text-gray-400">•</span>
          <span>{item.copies > 1 ? "Top" : "Bottom"}</span>
        </div>
      ) : null}
      {propertiesPortal}
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
      {/* Group Layout for Copies — virtual rows, absolute positioned */}
      <div
        className="relative"
        style={{ width: `${groupWidthPx}px`, height: `${totalGroupHeightPx}px` }}
      >
        {Array.from({ length: Math.max(0, lastVisibleRow - firstVisibleRow + 1) }, (_, ri) => {
          const row = firstVisibleRow + ri;
          return Array.from({ length: visibleCols }, (_, col) => {
            const index = row * visibleCols + col;
            if (index >= renderCopies) return null;
            return (
              <img
                key={index}
                src={item.url}
                crossOrigin="anonymous"
                alt={`copy-${index}`}
                className={`object-contain cursor-default rounded-sm ${
                  isSelected && renderCopies > 1 ? "border border-blue-500" : ""
                }`}
                style={{
                  position: "absolute",
                  left: `${col * (scaledWidth + gap) * ppi}px`,
                  top: `${row * (scaledHeight + gap) * ppi}px`,
                  width: `${scaledWidth * ppi}px`,
                  height: `${scaledHeight * ppi}px`,
                  transform: `scaleX(${item.flipped ? -1 : 1}) rotate(${item.rotation}deg)`,
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragActivatedRef.current = false;
                  savedMouseRef.current = { clientX: e.clientX, clientY: e.clientY };
                  cancelLongPress();
                  longPressTimerRef.current = setTimeout(() => {
                    longPressTimerRef.current = null;
                    dragActivatedRef.current = true;
                    if (savedMouseRef.current) {
                      onDragStart(savedMouseRef.current as unknown as React.MouseEvent);
                    }
                  }, 500);
                  document.addEventListener("mouseup", () => cancelLongPress(), { once: true });
                }}
              />
            );
          });
        })}
        {isRemovingBg && (
          <div className="absolute inset-0 z-20 pointer-events-none rounded-sm overflow-hidden">
            <div className="absolute inset-0 bg-violet-500 bg-removing-overlay" />
            <div
              className="absolute inset-x-0 bg-scan-beam"
              style={{
                height: "40%",
                background: "linear-gradient(to bottom, transparent, rgba(167,139,250,0.55), rgba(139,92,246,0.7), rgba(167,139,250,0.55), transparent)",
              }}
            />
          </div>
        )}
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
