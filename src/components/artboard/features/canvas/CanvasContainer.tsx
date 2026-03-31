import React from "react";
import { getGridStyle } from "../../lib/utils";
import CanvasRulers from "./CanvasRulers";
import CanvasMargins from "./CanvasMargins";
import EmptyState from "./EmptyState";
import ZoomControls from "../zoom/ZoomControls";
import ArtboardItem from "../items/ArtboardItem";
import { ArtboardItem as ArtboardItemType } from "../../types";

interface CanvasContainerProps {
  zoom: number;
  showRulers: boolean;
  showMargins: boolean;
  marginSize: number;
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
  const pct = Math.max(0, Math.min(100, uploadProgress));

  return (
    <div
      className="flex-1 relative flex items-center justify-center bg-white overflow-hidden"
      onWheel={onWheel}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="absolute inset-0 z-0 opacity-100"
        style={getGridStyle(zoom)}
      />
      <CanvasRulers showRulers={showRulers} zoom={zoom} />
      <CanvasMargins
        showMargins={showMargins}
        showRulers={showRulers}
        marginSize={marginSize}
        zoom={zoom}
      />
      <div
        className="absolute inset-0"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "center",
          transition: "transform 200ms ease-out",
        }}
        onClick={onCanvasClick}
      >
        <div className="absolute inset-0 z-10">
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
      <ZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />
    </div>
  );
}
