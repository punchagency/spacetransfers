import React, { useEffect, useMemo, useState } from "react";
import { MdAdd } from "react-icons/md";
import { getGridStyle } from "../../lib/utils";
import CanvasRulers from "./CanvasRulers";
import CanvasMargins from "./CanvasMargins";
import EmptyState from "./EmptyState";
import ZoomControls from "../zoom/ZoomControls";
import ArtboardItem from "../items/ArtboardItem";
import { ArtboardItem as ArtboardItemType } from "../../types";
import { CANVAS } from "../../../../config/artboard.config";

interface CanvasContainerProps {
  zoom: number;
  showRulers: boolean;
  showMargins: boolean;
  marginSize: number;
  spacing: number;
  autoNestStickers: boolean;
  isDragging: boolean;
  items: ArtboardItemType[];
  selectedId: number | null;
  selectedIds: Set<number>;
  showProperties: Record<number, boolean>;
  addedToCart: Set<number>;
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCanvasClick: () => void;
  onItemSelect: (id: number, multi?: boolean) => void;
  onToggleProperties: (id: number) => void;
  itemActions: any;
  onLink: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddToCart: (item: any) => void;
  onCloseProperties: () => void;
  onDragStart: (e: React.MouseEvent, id: number) => void;
  onResizeStart: (e: React.MouseEvent, id: number) => void;
  isDraggingItem: boolean;
  canvasWidth: number;
  emptyOffsetY?: number;
  onBrowseFiles: () => void;
  isUploading: boolean;
  uploadProgress: number;
  uploadFileName: string | null;
  onCancelUpload: () => void;
}

export default function CanvasContainer({
  zoom,
  showRulers,
  showMargins,
  marginSize,
  spacing,
  autoNestStickers,
  isDragging,
  items,
  selectedId,
  selectedIds,
  showProperties,
  addedToCart,
  onWheel,
  onDragOver,
  onDragLeave,
  onDrop,
  onZoomIn,
  onZoomOut,
  onCanvasClick,
  onItemSelect,
  onToggleProperties,
  itemActions,
  onLink,
  onDuplicate,
  onDelete,
  onAddToCart,
  onCloseProperties,
  onDragStart,
  onResizeStart,
  isDraggingItem,
  canvasWidth,
  emptyOffsetY = 0,
  onBrowseFiles,
  isUploading,
  uploadProgress,
  uploadFileName,
  onCancelUpload,
}: CanvasContainerProps) {
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);

  const clampedMenu = useMemo(() => {
    if (!menu) return null;
    const w = 240;
    const h = 112;
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - h - 8));
    return { x, y };
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onMouseDown = () => setMenu(null);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [menu]);

  const pct = Math.max(0, Math.min(100, uploadProgress));

  return (
    <div
      className="flex-1 relative flex items-center justify-center bg-white overflow-hidden"
      onWheel={onWheel}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(e) => {
        if (items.length === 0) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div
        className="absolute inset-0 z-0 opacity-100"
        style={getGridStyle(zoom)}
      />
      <CanvasRulers showRulers={showRulers} zoom={zoom} />
      <div
        className="absolute"
        style={{
          left: `${CANVAS.RULER_OFFSET_PX}px`,
          top: `${CANVAS.RULER_OFFSET_PX}px`,
          width: "100%",
          height: "100%",
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
          transition: "transform 200ms ease-out",
        }}
        onClick={onCanvasClick}
      >
        <CanvasMargins
          showMargins={showMargins}
          showRulers={showRulers}
          marginSize={marginSize}
          zoom={1}
        />
        {items.length > 0 ? (
          items.map((it) => (
            <ArtboardItem
              key={it.id}
              item={it}
              isSelected={selectedId === it.id || selectedIds.has(it.id)}
              showProperties={showProperties[it.id] || false}
              addedToCart={addedToCart.has(it.id)}
              onSelect={(multi) => onItemSelect(it.id, multi)}
              onToggleProperties={() => onToggleProperties(it.id)}
              onLink={onLink}
              onRotate={itemActions.rotateSelected}
              onToggleLock={itemActions.toggleLockSelected}
              onFlip={itemActions.flipSelected}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onToggleAutoCrop={itemActions.toggleAutoCrop}
              onSetCopies={itemActions.setCopies}
              onToggleLinked={itemActions.toggleLinked}
              onSetWidthIn={itemActions.setWidthIn}
              onSetHeightIn={itemActions.setHeightIn}
              onSetPosX={itemActions.setPosX}
              onSetPosY={itemActions.setPosY}
              onAddToCart={() => onAddToCart(it)}
              onCloseProperties={onCloseProperties}
              onDragStart={(e) => onDragStart(e, it.id)}
              onResizeStart={(e) => onResizeStart(e, it.id)}
              isDragging={isDraggingItem}
              canvasWidth={canvasWidth}
              marginSize={marginSize}
            />
          ))
        ) : (
          <div
            style={{
              transform: emptyOffsetY
                ? `translateY(${emptyOffsetY}px)`
                : undefined,
            }}
          >
            {!isUploading ? <EmptyState onBrowse={onBrowseFiles} /> : null}
          </div>
        )}
      </div>
      {isDragging && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="w-full h-full border-2 border-dashed border-blue-400 rounded" />
        </div>
      )}
      {isUploading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="w-[420px] max-w-[92vw] rounded-2xl border border-gray-200 bg-white px-10 py-10 text-center shadow-lg">
            <div className="mx-auto mb-4 flex items-center justify-center">
              <div
                className="relative h-14 w-14 rounded-full"
                style={{
                  background: `conic-gradient(#8CAFAB ${pct * 3.6}deg, #e5e7eb 0deg)`,
                }}
              >
                <div className="absolute inset-[6px] rounded-full bg-white" />
                <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-slate-700">
                  {Math.round(pct)}%
                </div>
              </div>
            </div>
            <div className="text-[16px] font-semibold text-slate-900">
              Uploading...
            </div>
            {uploadFileName ? (
              <div className="mt-1 text-[12px] text-slate-500">
                {uploadFileName}
              </div>
            ) : null}
            <button
              onClick={onCancelUpload}
              className="mx-auto mt-6 rounded-lg border border-slate-200 bg-white px-5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {clampedMenu && items.length > 0 && !isUploading ? (
        <div
          className="fixed inset-0 z-40 bg-black/10 backdrop-blur-sm"
          onMouseDown={() => setMenu(null)}
          aria-hidden="true"
        />
      ) : null}
      {clampedMenu && items.length > 0 && !isUploading ? (
        <div
          className="fixed z-50 w-[240px] rounded-xl   border border-gray-200 bg-white shadow-lg overflow-hidden"
          style={{ left: clampedMenu.x, top: clampedMenu.y }}
          role="menu"
          aria-label="Artboard context menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b   border-gray-100">
            <div className="text-[11px] font-semibold  text-gray-700">Item Spacing</div>
            <div className="text-[11px] text-gray-500">
              {autoNestStickers ? "Auto-Nest ON (tight)" : `${spacing.toFixed(2)} in`}
            </div>
            <div className="mt-1 text-[11px] text-gray-400">Add more item</div>
          </div>
          <div className="px-3 py-3">
            <button
              className="w-full flex items-center justify-center"
              onClick={() => {
                setMenu(null);
                onBrowseFiles();
              }}
              role="menuitem"
              aria-label="Add more item"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
                <MdAdd className="h-5 w-5" />
              </span>
            </button>
          </div>
        </div>
      ) : null}
      <ZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />
    </div>
  );
}
