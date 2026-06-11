import React, { useEffect, useMemo, useRef, useState } from "react";
import { MdAdd, MdOutlineFileUpload, MdArrowUpward } from "react-icons/md";
import { getGridStyle } from "../../lib/utils";
import CanvasRulers from "./CanvasRulers";
import CanvasMargins from "./CanvasMargins";
import EmptyState from "./EmptyState";
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
  onCanvasClick: () => void;
  onItemSelect: (id: number, multi?: boolean) => void;
  onToggleProperties: (id: number) => void;
  itemActions: any;
  onLink: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddToCart: (item: any) => void;
  onCloseProperties: () => void;
  onRemoveBg: (onProgress?: (phase: string, pct: number) => void) => Promise<void>;
  onDragStart: (e: React.MouseEvent, id: number) => void;
  onResizeStart: (e: React.MouseEvent, id: number) => void;
  isDraggingItem: boolean;
  canvasWidth: number;
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
  onCanvasClick,
  onItemSelect,
  onToggleProperties,
  itemActions,
  onLink,
  onDuplicate,
  onDelete,
  onAddToCart,
  onCloseProperties,
  onRemoveBg,
  onDragStart,
  onResizeStart,
  isDraggingItem,
  canvasWidth,
  onBrowseFiles,
  isUploading,
  uploadProgress,
  uploadFileName,
  onCancelUpload,
}: CanvasContainerProps) {
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const prevScrollTopRef = useRef(0);
  const scrollStopTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (scrollStopTimerRef.current !== null) {
      window.clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = null;
    }
  }, []);

  const handleScrollToTop = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
    setToolbarHidden(false);
  };

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
  const offset = CANVAS.RULER_OFFSET_PX;
  const ppi = CANVAS.PIXELS_PER_INCH;
  const maxSheetHeightIn = 1200; // 100 feet

  const isSheetFull = useMemo(() => {
    if (items.length === 0) return false;
    const gap = CANVAS.GRID_GAP_IN;
    const maxUsedIn = items.reduce((max, it) => {
      const copies = it.copies > 0 ? it.copies : 1;
      const groupH = copies <= 1 ? it.heightIn : copies * it.heightIn + (copies - 1) * gap;
      return Math.max(max, it.posY + groupH);
    }, 0);
    return maxUsedIn >= maxSheetHeightIn - 1;
  }, [items, maxSheetHeightIn]);

  // The artboard canvas always represents the full sheet capacity so the left
  // ruler (fixed at 1200 in) is reachable via scrolling. Content is placed
  // within that space; the canvas height does not shrink to the content extent.
  const sheetHeightPx = useMemo(() => {
    if (items.length === 0) return 0;
    return maxSheetHeightIn * ppi * zoom;
  }, [items.length, ppi, zoom, maxSheetHeightIn]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => setViewportHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

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
      <CanvasRulers
        showRulers={showRulers}
        zoom={zoom}
        sheetHeightPx={sheetHeightPx}
        scrollTopPx={scrollTop}
        viewportHeightPx={viewportHeight}
      />
      {/* Toolbar portal slot — ArtboardItem portals into this when selected.
          Slides up + fades out while the user scrolls down, returns when they
          scroll up or stop. */}
      <div
        id="artboard-toolbar-portal"
        className={`absolute z-50 pointer-events-none transition-all duration-200 ease-out ${
          toolbarHidden ? "-translate-y-3 opacity-0" : "translate-y-0 opacity-100"
        }`}
        style={{ top: offset, left: offset, right: 0 }}
      />

      {items.length === 0 ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          onClick={onCanvasClick}
        >
          {!isUploading ? <EmptyState onBrowse={onBrowseFiles} /> : null}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="absolute z-10"
            style={{
              left: `${offset}px`,
              top: `${offset}px`,
              right: 0,
              bottom: 0,
              overflowY: "auto",
              overflowX: "hidden",
              paddingBottom: `${ppi * zoom}px`,
            }}
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              const curr = target.scrollTop;
              setScrollTop(curr);

              // Direction-aware toolbar visibility.
              // Small delta threshold prevents flicker from sub-pixel scroll jitter on trackpads.
              const delta = curr - prevScrollTopRef.current;
              prevScrollTopRef.current = curr;
              if (delta > 4 && curr > 60) {
                setToolbarHidden(true);
              } else if (delta < -4) {
                setToolbarHidden(false);
              }

              // When scrolling stops, bring the toolbar back.
              if (scrollStopTimerRef.current !== null) {
                window.clearTimeout(scrollStopTimerRef.current);
              }
              scrollStopTimerRef.current = window.setTimeout(() => {
                setToolbarHidden(false);
                scrollStopTimerRef.current = null;
              }, 220);

              onCloseProperties();
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onCanvasClick(); }}
            onDoubleClick={(e) => { if (e.target === e.currentTarget && items.length < CANVAS.MAX_ITEMS && !isSheetFull) onBrowseFiles(); }}
          >
            <div
              className="relative"
              style={{
                width: `${canvasWidth * ppi * zoom}px`,
                height: `${sheetHeightPx}px`,
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
                transition: "transform 200ms ease-out",
              }}
            >
              <CanvasMargins
                showMargins={showMargins}
                marginSize={marginSize}
                heightIn={sheetHeightPx / (ppi * zoom)}
              />
              {items.map((it) => (
                <ArtboardItem
                  key={it.id}
                  item={it}
                  isSelected={selectedId === it.id || selectedIds.has(it.id)}
                  isPrimary={selectedId === it.id}
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
                  onIncreaseDpi={itemActions.increaseDpi}
                  onToggleAutoCrop={itemActions.toggleAutoCrop}
                  onSetCopies={itemActions.setCopies}
                  onToggleLinked={itemActions.toggleLinked}
                  onSetWidthIn={itemActions.setWidthIn}
                  onSetHeightIn={itemActions.setHeightIn}
                  onSetPosX={itemActions.setPosX}
                  onSetPosY={itemActions.setPosY}
                  onAddToCart={() => onAddToCart(it)}
                  onCloseProperties={onCloseProperties}
                  onRemoveBg={onRemoveBg}
                  onDragStart={(e) => onDragStart(e, it.id)}
                  onResizeStart={(e) => onResizeStart(e, it.id)}
                  isDragging={isDraggingItem}
                  canvasWidth={canvasWidth}
                  marginSize={marginSize}
                  spacing={spacing}
                  zoom={zoom}
                  scrollTop={scrollTop}
                  viewportHeight={viewportHeight}
                />
              ))}
            </div>
          </div>
        </>
      )}
      {/* Persistent drop hint — shown when items exist and not currently dragging */}
      {items.length > 0 && items.length < CANVAS.MAX_ITEMS && !isSheetFull && !isDragging && !isUploading && (
        <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-auto flex justify-center pb-5">
          <button
            onClick={onBrowseFiles}
            className="group flex items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white/90 backdrop-blur-sm px-7 py-3.5 shadow-md hover:border-slate-500 hover:bg-white hover:shadow-lg transition-all duration-200 cursor-pointer"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 group-hover:bg-slate-900 group-hover:text-white transition-colors duration-200 flex-shrink-0">
              <MdOutlineFileUpload size={20} />
            </span>
            <span className="flex flex-col items-start">
              <span className="text-[13px] font-semibold text-slate-700 group-hover:text-slate-900 leading-tight">Double-click anywhere or drop files to add more</span>
              <span className="text-[11px] text-slate-400 mt-0.5">PNG · JPG · SVG</span>
            </span>
          </button>
        </div>
      )}

      {/* Scroll-to-Top — fixed bottom-right, appears once the user has scrolled
          past ~300px. Always mounted so the show/hide is a pure CSS transition
          rather than a remount jolt. */}
      <button
        onClick={handleScrollToTop}
        aria-label="Scroll to top"
        title="Scroll to top"
        className={`fixed z-50 flex items-center justify-center w-12 h-12 rounded-full bg-slate-900 text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] hover:bg-slate-700 active:scale-95 transition-all duration-200 ease-out ${
          scrollTop > 300
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-3 pointer-events-none"
        }`}
        style={{
          // Respect iOS home indicator + Android nav bar / notch.
          bottom: "max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))",
          right: "max(1rem, env(safe-area-inset-right, 0px))",
        }}
      >
        <MdArrowUpward className="w-6 h-6" />
      </button>

      {/* {isDragging && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
          <div className="absolute inset-2 border-2 border-dashed border-blue-400 rounded-xl" />
          <div className="relative flex flex-col items-center gap-3 rounded-2xl bg-blue-50/90 backdrop-blur-sm px-10 py-8 shadow-lg border border-blue-200">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-500">
              <MdOutlineFileUpload size={28} />
            </div>
            <div className="text-[15px] font-semibold text-blue-700">Drop to add to artboard</div>
            <div className="text-[12px] text-blue-500">PNG • JPG • SVG</div>
          </div>
        </div>
      )} */}
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
              <div className="mt-1 text-[12px] text-slate-500 max-w-[220px] truncate text-center mx-auto" title={uploadFileName}>
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
    </div>
  );
}
