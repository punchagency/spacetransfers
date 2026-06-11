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
    flowCols?: number;
    flowStartCol?: number;
    flowEndCol?: number;
    dpi?: number;
    hasFade?: boolean;
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
  onIncreaseDpi: () => void;
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
  onIncreaseDpi,
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
  const pendingDragRef = useRef<(() => void) | null>(null);
  const dragActivatedRef = useRef(false);

  const cancelPendingDrag = useCallback(() => {
    pendingDragRef.current?.();
    pendingDragRef.current = null;
  }, []);

  useEffect(() => () => cancelPendingDrag(), [cancelPendingDrag]);

  // Dock the panel to the right side of the image.
  useEffect(() => {
    if (!showProperties || !itemRef.current) return;
    const rect = itemRef.current.getBoundingClientRect();
    const gap = 12;
    setPanelInitialPos({ x: rect.right + gap, y: rect.top });
  }, [showProperties, item.posX, item.posY, zoom, scrollTop]);

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

  const isLowDpi = typeof item.dpi === "number" && item.dpi < 300;
  const PT_TO_IN = 1 / 72;
  const isTooSmall = item.widthIn < 2 * PT_TO_IN || item.heightIn < 2 * PT_TO_IN;

  const hasFade = !!item.hasFade;

  // Priority: too-small (red) > fade (orange) > low-dpi (amber) > normal (blue)
  const borderColor = isTooSmall ? "#EF4444" : hasFade ? "#F97316" : isLowDpi ? "#EDAE00" : "#3b82f6";
  const borderColorHover = isTooSmall ? "#EF4444" : hasFade ? "#F97316" : isLowDpi ? "#EDAE00" : "#60a5fa";
  const handleColor = isTooSmall
    ? "bg-red-500"
    : hasFade
    ? "bg-orange-500"
    : isLowDpi
    ? "bg-[#EDAE00]"
    : "bg-blue-500";

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

  // Flow geometry — provided by calculateGridLayout when items share a lane.
  // Otherwise fall back to a fully-packed grid (first cell at col 0).
  const hasFlow =
    typeof item.flowCols === "number" &&
    typeof item.flowStartCol === "number" &&
    typeof item.flowEndCol === "number";
  const flowCols = hasFlow
    ? Math.max(1, item.flowCols!)
    : Math.max(1, Math.min(renderCopies, capacityCols));
  const flowStartCol = hasFlow ? Math.max(0, item.flowStartCol!) : 0;
  const flowEndColRaw = hasFlow
    ? Math.max(0, item.flowEndCol!)
    : renderCopies > 0
      ? (renderCopies - 1) % flowCols
      : 0;
  const flowEndCol = Math.min(flowCols - 1, flowEndColRaw);

  const visibleCols = flowCols;
  const rows = (() => {
    if (renderCopies <= 0) return 1;
    const firstRowCapacity = Math.max(1, flowCols - flowStartCol);
    if (renderCopies <= firstRowCapacity) return 1;
    const remaining = renderCopies - firstRowCapacity;
    return 1 + Math.ceil(remaining / flowCols);
  })();

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

  // Step geometry — the bordered region can have an inward step on the top-left
  // (partial first row) and/or the bottom-right (partial last row) so it hugs
  // the item's actual cells inside a flow lane.
  const hasPartialFirstRow = rows > 1 && flowStartCol > 0;
  const hasPartialLastRow = rows > 1 && flowEndCol < flowCols - 1;
  const firstRowStartXPx = flowStartCol * (scaledWidth + gap) * ppi;
  const firstRowBottomStepYPx = (scaledHeight + gap) * ppi;
  const lastRowEndXPx =
    ((flowEndCol + 1) * scaledWidth + flowEndCol * gap) * ppi;
  const lastRowTopPx = (rows - 1) * (scaledHeight + gap) * ppi;

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

  // Build the bordered region as a polygon that hugs the actual cells, with
  // optional inward steps on the top-left (partial first row) and bottom-right
  // (partial last row). Used for both the SVG outline and the clip-path that
  // limits the inner content div's hit area to occupied cells.
  const polygonPoints: Array<[number, number]> = [];
  polygonPoints.push([firstRowStartXPx, 0]);
  polygonPoints.push([groupWidthPx, 0]);
  if (hasPartialLastRow) {
    polygonPoints.push([groupWidthPx, lastRowTopPx]);
    polygonPoints.push([lastRowEndXPx, lastRowTopPx]);
    polygonPoints.push([lastRowEndXPx, totalGroupHeightPx]);
  } else {
    polygonPoints.push([groupWidthPx, totalGroupHeightPx]);
  }
  polygonPoints.push([0, totalGroupHeightPx]);
  if (hasPartialFirstRow) {
    polygonPoints.push([0, firstRowBottomStepYPx]);
    polygonPoints.push([firstRowStartXPx, firstRowBottomStepYPx]);
  }

  const polygonPathD =
    polygonPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
      .join(" ") + " Z";

  const polygonClipPath =
    hasPartialFirstRow || hasPartialLastRow
      ? `polygon(${polygonPoints.map((p) => `${p[0]}px ${p[1]}px`).join(", ")})`
      : undefined;

  return (
    <div
      ref={itemRef}
      data-item-id={item.id}
      className="absolute rounded-md transition-shadow duration-300 ease-out"
      style={{
        left: `${clampedLeft * CANVAS.PIXELS_PER_INCH}px`,
        top: `${clampedTop * CANVAS.PIXELS_PER_INCH}px`,
        touchAction: "none",
        zIndex: isSelected ? 1000 : item.copies > 1 ? 30 : 10,
        pointerEvents: "none",
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
            onIncreaseDpi={onIncreaseDpi}
            currentDpi={item.dpi}
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
        style={{
          width: `${groupWidthPx}px`,
          height: `${totalGroupHeightPx}px`,
          pointerEvents: "auto",
          clipPath: polygonClipPath,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); cancelPendingDrag(); }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(false);
          if (!showProperties) onToggleProperties();
        }}
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
          }
        }}
      >
        {Array.from({ length: Math.max(0, lastVisibleRow - firstVisibleRow + 1) }, (_, ri) => {
          const row = firstVisibleRow + ri;
          return Array.from({ length: visibleCols }, (_, col) => {
            // Skip cells outside this item's occupied flow region.
            if (row === 0 && col < flowStartCol) return null;
            if (row === rows - 1 && col > flowEndCol) return null;
            const firstRowCapacity = flowCols - flowStartCol;
            const index =
              row === 0
                ? col - flowStartCol
                : firstRowCapacity + (row - 1) * flowCols + col;
            if (index < 0 || index >= renderCopies) return null;
            return (
              <img
                key={index}
                src={item.url}
                crossOrigin="anonymous"
                draggable={false}
                alt={`copy-${index}`}
                className={`object-contain cursor-default rounded-sm ${
                  isSelected && renderCopies > 1
                    ? `border ${isTooSmall ? "border-red-500" : hasFade ? "border-orange-500" : isLowDpi ? "border-[#EDAE00]" : "border-blue-500"}`
                    : ""
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
                  e.preventDefault();
                  dragActivatedRef.current = false;
                  cancelPendingDrag();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const THRESHOLD_SQ = 4 * 4;

                  const onMove = (moveEvt: MouseEvent) => {
                    const dx = moveEvt.clientX - startX;
                    const dy = moveEvt.clientY - startY;
                    if (dx * dx + dy * dy >= THRESHOLD_SQ) {
                      cleanup();
                      dragActivatedRef.current = true;
                      onDragStart({ clientX: startX, clientY: startY } as React.MouseEvent);
                    }
                  };
                  const onUp = () => cleanup();
                  const cleanup = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    pendingDragRef.current = null;
                  };
                  document.addEventListener("mousemove", onMove);
                  document.addEventListener("mouseup", onUp, { once: true });
                  pendingDragRef.current = cleanup;
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
        {(isTooSmall || hasFade) && (
          <div className="absolute bottom-1 left-1 z-30 flex gap-1 pointer-events-auto group/warn cursor-default">
            {isTooSmall && (
              <span className="w-4 h-4 rounded-full bg-red-500 border border-white flex items-center justify-center text-white text-[9px] font-bold leading-none select-none">
                !
              </span>
            )}
            {hasFade && (
              <span className="w-4 h-4 rounded-full bg-orange-500 border border-white flex items-center justify-center leading-none select-none">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </span>
            )}
            <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/warn:flex flex-col gap-1 min-w-[220px] max-w-[280px] rounded-xl border border-gray-200 bg-white shadow-lg px-3 py-2.5 pointer-events-none z-50">
              {isTooSmall && (
                <p className="text-[11px] leading-snug text-red-600 font-medium">
                  Items smaller than 2pt may not print properly.
                </p>
              )}
              {hasFade && (
                <p className="text-[11px] leading-snug text-orange-600 font-medium">
                  DTF Technology cannot print fades. Please remove transparency gradients or fading into transparency.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {(isSelected || isHovered) && (
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{ overflow: "visible" }}
          width={groupWidthPx}
          height={totalGroupHeightPx}
        >
          <path
            d={polygonPathD}
            fill="none"
            stroke={isSelected ? borderColor : borderColorHover}
            strokeWidth={4}
            strokeLinejoin="round"
            strokeDasharray={isTooSmall ? "6 3" : undefined}
          />
        </svg>
      )}
      {isSelected && (
        <>
          <span
            className={`absolute -top-2 -left-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white cursor-nwse-resize pointer-events-auto`}
            onMouseDown={onResizeStart}
          />
          <span
            className={`absolute -top-2 -right-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white cursor-nesw-resize pointer-events-auto`}
            onMouseDown={onResizeStart}
          />
          <span
            className={`absolute -bottom-2 -left-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white cursor-nesw-resize pointer-events-auto`}
            onMouseDown={onResizeStart}
          />
          <span
            className={`absolute -bottom-2 -right-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white cursor-nwse-resize pointer-events-auto`}
            onMouseDown={onResizeStart}
          />
        </>
      )}
    </div>
  );
}
