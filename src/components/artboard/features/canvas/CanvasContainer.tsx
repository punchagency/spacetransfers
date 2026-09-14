import React, { useEffect, useMemo, useRef, useState } from "react";
import { MdAdd, MdOutlineFileUpload, MdArrowUpward } from "react-icons/md";
import { getGridStyle, CHECKER_PAIRS, isDarkBg } from "../../lib/utils";
import CanvasRulers from "./CanvasRulers";
import CanvasMargins from "./CanvasMargins";
import CanvasGrid from "./CanvasGrid";
import EmptyState from "./EmptyState";
import BulkLoadOverlay from "./BulkLoadOverlay";
import QueueBadge from "./QueueBadge";
import ArtboardItem from "../items/ArtboardItem";
import { ArtboardItem as ArtboardItemType } from "../../types";
import { CANVAS, UPLOAD_FORMAT_LABELS } from "../../../../config/artboard.config";
import { getItemVerticalExtent } from "../../lib/utils/layoutHelpers";
import type { DropIndicator, PreviewOffset } from "../../lib/hooks/useMouseInteractions";
import type { AiPanelBridge } from "../ai";

interface CanvasContainerProps {
  zoom: number;
  showRulers: boolean;
  showGrid: boolean;
  showMargins: boolean;
  marginSize: number;
  spacing: number;
  autoNestStickers: boolean;
  canvasBg?: string;
  isDragging: boolean;
  isResizing: boolean;
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
  liftedIds?: Set<number>;
  previewOffsets?: Map<number, PreviewOffset>;
  dropIndicator?: DropIndicator | null;
  canvasWidth: number;
  onBrowseFiles: () => void;
  isUploading: boolean;
  uploadProgress: number;
  /** Images placed so far in the active bulk batch. */
  batchLoaded?: number;
  /** Size of the active bulk batch; 0 when none is running. */
  batchTotal?: number;
  /** Files dropped mid-batch and held until the active one finishes. */
  queuedCount?: number;
  /**
   * Ids the top-bar DPI chip is counting, or null when the highlight is off.
   * Chrome only — nothing about an item's geometry or content is read from it.
   */
  dpiHighlightIds?: Set<number> | null;
  uploadFileName: string | null;
  onCancelUpload: () => void;
  /** Something else (the AI button) occupies the bottom-right — lift the scroll-to-top control clear of it. */
  avoidBottomRight?: boolean;
  /** Shared AI panel state + actions, threaded down to each item's toolbar/panel. */
  aiPanel?: AiPanelBridge;
}

function canvasBgStyle(bg: string | undefined, zoom: number): React.CSSProperties {
  const id = bg || 'transparent';
  if (id === 'rainbow') {
    return {
      backgroundImage:
        'linear-gradient(135deg,#f857a6 0%,#ff5858 16%,#ffae58 33%,#fffe58 50%,#58ff89 66%,#58c6ff 83%,#b558ff 100%)',
    };
  }
  const [c1, c2] = CHECKER_PAIRS[id] ?? CHECKER_PAIRS['transparent'];
  return getGridStyle(zoom, c1, c2);
}

export default function CanvasContainer({
  zoom,
  showRulers,
  showGrid,
  showMargins,
  marginSize,
  spacing,
  autoNestStickers,
  canvasBg,
  isDragging,
  isResizing,
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
  liftedIds,
  previewOffsets,
  dropIndicator,
  canvasWidth,
  onBrowseFiles,
  isUploading,
  uploadProgress,
  batchLoaded = 0,
  batchTotal = 0,
  queuedCount = 0,
  dpiHighlightIds = null,
  uploadFileName,
  onCancelUpload,
  avoidBottomRight = false,
  aiPanel,
}: CanvasContainerProps) {
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const prevScrollTopRef = useRef(0);
  const scrollStopTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  /**
   * Whether a pointer event landed on empty sheet rather than on artwork.
   *
   * This used to be `e.target === e.currentTarget` — true only when the browser
   * reported the scroll container itself. The sheet inside it is sized in zoomed
   * pixels and then scaled by zoom again, so its hit box is zoom² of the sheet:
   * at 62% it covered the left 62%, where a click reported that inner div and
   * was ignored. Clicking away did not deselect and double-click did not add
   * files there, yet both worked on the strip to its right.
   *
   * So this asks what matters instead: was it outside every item? `contains`
   * keeps out events React bubbles up from portals — the item toolbar and the
   * properties panel live elsewhere in the DOM but still bubble through this
   * component, and pressing one of their buttons must not deselect the item.
   */
  const isEmptySheetTarget = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    return Boolean(target && e.currentTarget.contains(target) && !target.closest("[data-item-id]"));
  };

  /*
   * A click only counts as on the sheet if the press started there too. Dragging
   * an item and releasing over empty space fires `click` on their common
   * ancestor, which would otherwise deselect the piece just placed. Captured,
   * because items stop mousedown from propagating.
   */
  const pressedOnSheetRef = useRef(false);

  useEffect(() => () => {
    if (scrollStopTimerRef.current !== null) {
      window.clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = null;
    }
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  /**
   * Publishes scrollTop at most once per frame.
   *
   * `scrollTop` is threaded down to every mounted item (they use it to decide
   * which of their own copy-rows to draw), so a `setState` per scroll event
   * meant a full pass over the item tree 100+ times a second — the browser
   * fires scroll far faster than it paints. Coalescing to one update per frame
   * makes the work proportional to frames rather than to events, with no
   * visible difference: nothing can be seen between two paints anyway.
   */
  const pendingScrollTopRef = useRef(0);
  const publishScrollTop = React.useCallback((value: number) => {
    // Latest value wins: the ref is overwritten by every event in the frame and
    // read when the frame runs. Capturing `value` in the callback instead would
    // publish the *first* position of the frame and render a stale viewport.
    pendingScrollTopRef.current = value;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(pendingScrollTopRef.current);
    });
  }, []);

  const handleScrollToTop = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
    setToolbarHidden(false);
  };

  /**
   * Bring the first flagged item into view when the DPI highlight turns on.
   *
   * A sheet can be a hundred feet long, so on a large board every flagged image
   * may well be scrolled past — an outline nobody can see answers "where is the
   * bad artwork?" no better than the number on the chip did. This is the
   * navigation half of the feature; the outline is only the identification half.
   *
   * Nothing is moved: the *viewport* scrolls, item positions are untouched.
   *
   * Fires only on the off→on transition. `dpiHighlightIds` is rebuilt whenever
   * `items` changes, so without the latch a background upload finishing would
   * yank the viewport back while the customer was reading somewhere else.
   */
  const wasDpiHighlightingRef = useRef(false);
  useEffect(() => {
    const active = Boolean(dpiHighlightIds && dpiHighlightIds.size > 0);
    const wasActive = wasDpiHighlightingRef.current;
    wasDpiHighlightingRef.current = active;
    if (!active || wasActive) return;

    const el = scrollRef.current;
    if (!el) return;

    let firstTopIn = Number.POSITIVE_INFINITY;
    for (const it of items) {
      if (!dpiHighlightIds!.has(it.id)) continue;
      const { topIn } = getItemVerticalExtent(it, canvasWidth, marginSize, spacing);
      if (topIn < firstTopIn) firstTopIn = topIn;
    }
    if (!Number.isFinite(firstTopIn)) return;

    // `CANVAS.PIXELS_PER_INCH` rather than the `ppi` alias, which is declared
    // further down the component.
    const targetPx = firstTopIn * CANVAS.PIXELS_PER_INCH * zoom;
    // Already on screen — leave the viewport alone. Scrolling to something the
    // customer is already looking at reads as the board jumping for no reason.
    if (targetPx >= el.scrollTop && targetPx <= el.scrollTop + el.clientHeight) {
      return;
    }
    // A little headroom above the item, so it lands inside the viewport rather
    // than flush against its top edge.
    el.scrollTo({ top: Math.max(0, targetPx - 80), behavior: "smooth" });
  }, [dpiHighlightIds, items, canvasWidth, marginSize, spacing, zoom]);

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

  /**
   * Item count below which culling is skipped entirely.
   *
   * Virtualizing a handful of items costs more than it saves and adds a way for
   * a small board — the overwhelmingly common case — to behave differently from
   * before. Above this, the cost of mounting every item starts to dominate.
   */
  const VIRTUALIZE_THRESHOLD = 60;

  /**
   * Extra band rendered beyond the viewport, in scroll-container pixels.
   *
   * Covers fast scrolling (roughly one screenful at a typical viewport) and any
   * small discrepancy between the culling extent and an item's real drawn
   * height, so nothing pops in at the edges.
   */
  const OVERSCAN_PX = 900;

  /**
   * The items actually mounted this frame.
   *
   * Without this, `items.map` mounts one `ArtboardItem` per placement — each
   * with its own effects, refs, image element and portal targets. At a thousand
   * placements that is thousands of live components, which is what made large
   * sheets freeze and eventually crash the tab. Culling to the visible band
   * makes render cost track the viewport instead of the design.
   *
   * Four categories are never culled, because removing them would break
   * behaviour rather than merely skip drawing:
   *  - the selection, whose toolbar is portaled out of the item and would
   *    vanish along with it,
   *  - anything with its properties panel open, for the same reason,
   *  - items being dragged or displaced, whose live offsets are not reflected
   *    in their stored position,
   *  - everything, while the viewport height is still unmeasured (first paint),
   *    since a zero-height viewport would cull the entire sheet.
   */
  const visibleItems = useMemo(() => {
    if (items.length < VIRTUALIZE_THRESHOLD) return items;
    if (viewportHeight <= 0) return items;

    const bandTop = scrollTop - OVERSCAN_PX;
    const bandBottom = scrollTop + viewportHeight + OVERSCAN_PX;
    const pxPerInch = ppi * zoom;

    return items.filter((it) => {
      if (it.id === selectedId || selectedIds.has(it.id)) return true;
      if (showProperties[it.id]) return true;
      if (liftedIds?.has(it.id) || previewOffsets?.has(it.id)) return true;

      const { topIn, bottomIn } = getItemVerticalExtent(
        it,
        canvasWidth,
        marginSize,
        spacing,
      );
      return bottomIn * pxPerInch >= bandTop && topIn * pxPerInch <= bandBottom;
    });
  }, [
    items,
    viewportHeight,
    scrollTop,
    ppi,
    zoom,
    selectedId,
    selectedIds,
    showProperties,
    liftedIds,
    previewOffsets,
    canvasWidth,
    marginSize,
    spacing,
  ]);

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
      {/*
        Behind everything. With artwork on the board this is the space *around*
        the sheet, in a flat neutral; the sheet draws its own surface below. The
        preview background used to fill this whole area, so zoomed out it ran
        past the sheet's edge and nothing showed where the roll ended.
      */}
      <div
        className="absolute inset-0 z-0 opacity-100 transition-[background-color,background-image] duration-200"
        style={
          items.length === 0
            ? canvasBgStyle(canvasBg, zoom)
            : { backgroundColor: isDarkBg(canvasBg ?? "transparent") ? "#0b1220" : "#e5e7eb" }
        }
      />
      <CanvasRulers
        showRulers={showRulers}
        sheetWidthIn={canvasWidth}
        zoom={zoom}
        sheetHeightPx={sheetHeightPx}
        scrollTopPx={scrollTop}
        viewportHeightPx={viewportHeight}
        canvasBg={canvasBg}
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
            id="artboard-scroll-container"
            className="absolute z-10"
            style={{
              left: `${offset}px`,
              top: `${offset}px`,
              right: 0,
              bottom: 0,
              overflowY: "auto",
              overflowX: "hidden",
              paddingBottom: `${ppi * zoom}px`,
              userSelect: isResizing ? "none" : "auto",
            }}
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              const curr = target.scrollTop;
              publishScrollTop(curr);

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
            onMouseDownCapture={(e) => {
              pressedOnSheetRef.current = isEmptySheetTarget(e);
            }}
            onClick={(e) => {
              if (pressedOnSheetRef.current && isEmptySheetTarget(e)) onCanvasClick();
            }}
            onDoubleClick={(e) => {
              if (isEmptySheetTarget(e) && items.length < CANVAS.MAX_ITEMS && !isSheetFull) onBrowseFiles();
            }}
          >
            <div
              id="artboard-canvas-inner"
              className="relative"
              style={{
                width: `${canvasWidth * ppi * zoom}px`,
                height: `${sheetHeightPx}px`,
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
                transition: "transform 200ms ease-out",
              }}
            >
              {/* Under the margin guide and the artwork — a grid that sits on
                  top of the items would fight them for attention. */}
              {/* The sheet itself: exactly the roll's width, scrolling with the
                  artwork, with a hairline at its edge. */}
              <div
                aria-hidden
                className="absolute top-0 left-0 pointer-events-none"
                style={{
                  ...canvasBgStyle(canvasBg, 1),
                  zIndex: 0,
                  width: `${canvasWidth * ppi}px`,
                  height: `${sheetHeightPx / (ppi * zoom) * ppi}px`,
                  boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.22)",
                }}
              />
              <CanvasGrid
                showGrid={showGrid}
                sheetWidthIn={canvasWidth}
                heightIn={sheetHeightPx / (ppi * zoom)}
                isDarkBg={isDarkBg(canvasBg ?? 'transparent')}
              />
              <CanvasMargins
                showMargins={showMargins}
                sheetWidthIn={canvasWidth}
                marginSize={marginSize}
                heightIn={sheetHeightPx / (ppi * zoom)}
                isDarkBg={isDarkBg(canvasBg ?? 'transparent')}
              />
              {/* Live placement preview — outlines exactly where the dragged
                  footprint will land when released. */}
              {dropIndicator ? (
                <div
                  className="absolute rounded-lg pointer-events-none"
                  style={{
                    left: `${dropIndicator.xIn * ppi}px`,
                    top: `${dropIndicator.yIn * ppi}px`,
                    width: `${dropIndicator.wIn * ppi}px`,
                    height: `${dropIndicator.hIn * ppi}px`,
                    border: `2px dashed ${dropIndicator.valid ? "rgba(59,130,246,0.8)" : "rgba(245,158,11,0.8)"}`,
                    background: dropIndicator.valid ? "rgba(59,130,246,0.07)" : "rgba(245,158,11,0.08)",
                    zIndex: 5,
                  }}
                />
              ) : null}
              {visibleItems.map((it) => (
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
                  isLifted={liftedIds?.has(it.id) ?? false}
                  previewOffset={previewOffsets?.get(it.id)}
                  displacementActive={isDraggingItem}
                  aiPanel={aiPanel}
                  scrollContainerRef={scrollRef}
                  canvasWidth={canvasWidth}
                  marginSize={marginSize}
                  spacing={spacing}
                  zoom={zoom}
                  scrollTop={scrollTop}
                  viewportHeight={viewportHeight}
                  isDpiHighlighted={dpiHighlightIds?.has(it.id) ?? false}
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
              <span className="text-[11px] text-slate-400 mt-0.5" title={UPLOAD_FORMAT_LABELS.join(", ")}>
                {UPLOAD_FORMAT_LABELS.slice(0, 7).join(" · ")} & more
              </span>
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
          // Respect iOS home indicator + Android nav bar / notch, and step above
          // the AI button when it's docked in this same corner.
          bottom: avoidBottomRight
            ? "calc(max(1.25rem, env(safe-area-inset-bottom, 0px) + 0.75rem) + 4.75rem)"
            : "max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))",
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
            <div className="text-[12px] text-blue-500">PNG • JPG • PDF</div>
          </div>
        </div>
      )} */}
      {/*
        Bulk drops get the corner overlay, not the modal below.

        The modal is `inset-0 z-30` — it covers the entire canvas. That was
        survivable when a drop was a handful of files, but on a 100+ image
        batch it hid the artboard for the whole upload, and since items were
        only committed after the last file finished there was nothing to see
        behind it anyway. Items now land progressively, so the canvas has to
        stay visible and interactive while the batch runs.

        A single file keeps the modal: it is brief, and a byte-percentage is
        more informative than "1 / 1 images loaded" for one large artwork.
      */}
      {/* One positioned wrapper, sized to the progress card. `QueueBadge`
          anchors to its edges, so the two panels stay a fixed distance apart
          at any viewport width while the progress card itself stays centred on
          the canvas — the card must not shift sideways just because images got
          queued behind it. */}
      {(batchTotal > 1 || queuedCount > 0) && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-30 w-[360px] max-w-[92vw] -translate-x-1/2">
          <BulkLoadOverlay
            loaded={batchLoaded}
            total={batchTotal}
            onCancel={onCancelUpload}
          />
          <QueueBadge count={queuedCount} />
        </div>
      )}
      {/* `queuedCount === 0` so a single-file batch with images waiting behind
          it shows the compact overlay (which can display the queue badge)
          rather than this modal, which has nowhere to put it. */}
      {isUploading && batchTotal <= 1 && queuedCount === 0 && (
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
              {/* Spacing applies with auto-nest on too; "tight" claimed it did not. */}
              {`${spacing.toFixed(2)} in${autoNestStickers ? " · auto-nest on" : ""}`}
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
