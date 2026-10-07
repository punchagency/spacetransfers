import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import ItemToolbar from "./ItemToolbar";
import PropertiesPanel from "./PropertiesPanel";
import { AiImagePanel } from "../ai";
import type { AiPanelBridge } from "../ai";
import { CANVAS, MAX_SHEET_HEIGHT_IN } from "../../../../config/artboard.config";
import { computeGroupDims, computeRenderCopies } from "../../lib/utils/layoutHelpers";
import { shouldWarn, transparencyMessage, type FadeVerdict } from "../../lib/utils/fadeCheck";
import { readImageInfo } from "../../lib/utils/imageUtils";
import type { PixelBatchResult } from "../../lib/hooks/useItemActions";
import type { SelectionSummary } from "../../types";

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
    nativeWidthPx?: number;
    croppedWidthPx?: number;
    nestRotation?: 0 | 90;
  };
  isSelected: boolean;
  isPrimary: boolean;
  /**
   * True while the top-bar DPI chip's highlight is on and this item is one of
   * the images it counts. Chrome only — it adds an outline and changes nothing
   * about the item's geometry, transform or content.
   */
  isDpiHighlighted?: boolean;
  /**
   * The transparency check's verdict for this item's current image, or
   * undefined while it is still being checked (`useTransparencyVerdicts`).
   */
  transparency?: FadeVerdict;
  showProperties: boolean;
  onSelect: (multi?: boolean) => void;
  onToggleProperties: () => void;
  onGroup: () => void;
  groupAction: "group" | "ungroup" | null;
  onRotate: () => void;
  onToggleLock: () => void;
  onFlip: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Upscales every selected image below 300 DPI; reports progress per image. */
  onIncreaseDpi: (onProgress?: (phase: string) => void) => Promise<PixelBatchResult>;
  onToggleAutoCrop: () => void;
  onSetCopies: (n: number) => void;
  onToggleLinked: () => void;
  onSetWidthIn: (n: number) => void;
  onSetHeightIn: (n: number) => void;
  onSetPosX: (n: number) => void;
  onSetPosY: (n: number) => void;
  onCloseProperties: () => void;
  /** Removes the background from every selected image that has one. */
  onRemoveBg: (onProgress?: (phase: string, pct: number) => void) => Promise<PixelBatchResult>;
  /** Reports the image's measured pixel width, for pieces that arrived without one. */
  onMeasured?: (id: number, widthPx: number) => void;
  /** The whole selection, for the toolbar this piece shows when it is the primary. */
  selection?: SelectionSummary;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  isDragging: boolean;
  canvasWidth: number;
  marginSize: number;
  spacing: number;
  zoom: number;
  scrollTop: number;
  viewportHeight: number;
  /** This item is the one being dragged — render the iOS "lift" (scale + shadow). */
  isLifted?: boolean;
  /** Live displacement preview: how far (inches) this item is nudged out of the
   *  dragged item's way. Rendered as a transform only — never committed here. */
  previewOffset?: { dx: number; dy: number };
  /** True while any drag is in flight — gates the displacement transition so
   *  clearing offsets on drop swaps instantly instead of animating back. */
  displacementActive?: boolean;
  /** Contextual AI panel state + actions (shared across all items). */
  aiPanel?: AiPanelBridge;
  /** Reference to the scroll container for hiding the AI panel during scroll. */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

function ArtboardItem({
  item,
  isSelected,
  isPrimary,
  selection,
  isDpiHighlighted = false,
  transparency,
  showProperties,
  onSelect,
  onToggleProperties,
  onGroup,
  groupAction,
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
  onCloseProperties,
  onRemoveBg,
  onMeasured,
  onDragStart,
  onResizeStart,
  isDragging,
  canvasWidth,
  marginSize,
  spacing,
  zoom,
  scrollTop,
  viewportHeight,
  isLifted = false,
  previewOffset,
  displacementActive = false,
  aiPanel,
  scrollContainerRef,
}: ArtboardItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [bgStatus, setBgStatus] = useState<'detecting' | 'has-bg' | 'no-bg'>('detecting');
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [bgProgress, setBgProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [naturalWidthPx, setNaturalWidthPx] = useState<number | null>(null);
  const [isDpiEnhancing, setIsDpiEnhancing] = useState(false);
  const [dpiProgress, setDpiProgress] = useState<string | null>(null);
  const [dpiEnhanced, setDpiEnhanced] = useState(false);
  const [bgJustRemoved, setBgJustRemoved] = useState(false);
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

  const aiOpen = aiPanel?.openItemId === item.id;

  // Detect whether the image has a solid background by sampling the 4 corners.
  // All-transparent corners → already no background → disable Remove BG.
  // Also captures natural dimensions for effective-DPI calculation (pixels / current widthIn).
  useEffect(() => {
    setBgStatus('detecting');
    setNaturalWidthPx(null);
    setDpiEnhanced(false);
    setBgJustRemoved(false);
    let cancelled = false;
    readImageInfo(item.url).then((info) => {
      if (cancelled) return;
      if (!info) { setBgStatus('has-bg'); return; }
      setNaturalWidthPx(info.widthPx);
      setBgStatus(info.hasBackground ? 'has-bg' : 'no-bg');
      // A piece reopened from a saved sheet, a restored cart or a reorder has
      // no pixel count (it isn't saved), so the DPI check counted it as
      // "unknown" and flagged the whole sheet. Recorded once measured.
      if (!item.nativeWidthPx && !item.croppedWidthPx) onMeasured?.(item.id, info.widthPx);
    });
    return () => { cancelled = true; };
  }, [item.url]);

  /**
   * One toast for a run over the selection: what changed, what was skipped
   * and why, and the first error if any image failed.
   */
  const reportBatch = (
    r: PixelBatchResult,
    words: { done: (n: number) => string; skipped: string; nothing: string },
  ) => {
    const notes: string[] = [];
    if (r.skipped > 0) notes.push(`${r.skipped} ${words.skipped}`);
    if (r.locked > 0) notes.push(`${r.locked} locked`);
    const tail = notes.length > 0 ? ` (${notes.join(", ")} left as is)` : "";
    if (r.failed > 0) {
      const prefix = r.done > 0 ? `${words.done(r.done)}, but ${r.failed} failed: ` : "";
      toast.error(prefix + (r.firstError ?? "Something went wrong. Please try again."));
    } else if (r.done > 0) {
      toast.success(words.done(r.done) + tail);
    } else {
      toast(words.nothing + tail, { icon: "ℹ️" });
    }
  };

  const plural = (n: number) => `${n} image${n === 1 ? "" : "s"}`;

  const handleRemoveBg = async () => {
    setIsRemovingBg(true);
    setBgJustRemoved(false);
    setBgProgress({ phase: "Starting...", pct: 0 });
    try {
      const result = await onRemoveBg((phase, pct) => setBgProgress({ phase, pct }));
      if (result.done > 0 && result.failed === 0) setBgJustRemoved(true);
      reportBatch(result, {
        done: (n) => (n === 1 ? "Background removed" : `Backgrounds removed from ${plural(n)}`),
        skipped: "already transparent",
        nothing: "Nothing to remove — the selected images are already transparent.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Background removal failed";
      toast.error(msg);
    } finally {
      setIsRemovingBg(false);
      setBgProgress(null);
    }
  };

  const handleIncreaseDpi = async () => {
    if (isDpiEnhancing) return;
    // Each image's upscale factor is worked out from its own DPI in the action.
    setIsDpiEnhancing(true);
    try {
      const result = await onIncreaseDpi((phase) => setDpiProgress(phase));
      if (result.done > 0 && result.failed === 0) setDpiEnhanced(true);
      reportBatch(result, {
        done: (n) => (n === 1 ? "Image enhanced to 300 DPI" : `${plural(n)} enhanced to 300 DPI`),
        skipped: "already at 300 DPI",
        nothing: "Nothing to enhance — the selected images are already at 300 DPI.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "DPI enhancement failed. Please try again.";
      toast.error(msg);
    } finally {
      setIsDpiEnhancing(false);
      setDpiProgress(null);
    }
  };

  // Effective DPI = actual image pixels / current display width in inches —
  // recalculated continuously so scaling an item larger after an upscale (or
  // any other DPI-affecting operation) still surfaces a fresh low-DPI warning
  // instead of permanently trusting a one-time snapshot.
  const effectiveDpi = useMemo(() => {
    // Every 90° rotation swaps widthIn/heightIn (rotateSelected), but the
    // image's own pixel width always describes its unrotated width axis. At
    // odd rotations that axis is displayed along heightIn, so measure against
    // that — dividing by widthIn there compared perpendicular axes and threw
    // false low-DPI warnings on rotated non-square art.
    const rotationOdd = ((Math.round(item.rotation / 90) % 2) + 2) % 2 === 1;
    const widthAxisIn = rotationOdd ? item.heightIn : item.widthIn;
    if (naturalWidthPx !== null && widthAxisIn > 0) {
      return Math.round(naturalWidthPx / widthAxisIn);
    }
    // Bridge the brief window between a url change (crop/BG-remove/upscale)
    // and the new image finishing the background load below — nativeWidthPx
    // is set synchronously in the same update as the new url, so it already
    // reflects the just-completed operation without waiting on a fresh load.
    if (typeof item.nativeWidthPx === "number" && widthAxisIn > 0) {
      return Math.round(item.nativeWidthPx / widthAxisIn);
    }
    return typeof item.dpi === "number" ? item.dpi : null;
  }, [naturalWidthPx, item.widthIn, item.heightIn, item.rotation, item.dpi, item.nativeWidthPx]);

  const isLowDpi = typeof effectiveDpi === "number" && effectiveDpi < 300;
  // No DPI could be determined at all — neither a loaded image's real pixel
  // width nor any stored dpi/nativeWidthPx snapshot is available. Treated as
  // a warning state (not silently assumed fine) so the print risk is visible
  // and the enhancer is still offered, but with honest "unknown" copy rather
  // than falsely claiming a specific under-300 number.
  const isDpiUnknown = effectiveDpi === null;
  const needsDpiAttention = isLowDpi || isDpiUnknown;

  // Clear the "just enhanced" checkmark once DPI has genuinely dropped below
  // 300 again (e.g. the user scaled the item larger post-enhancement) — a
  // resize doesn't change item.url, so the url-change reset effect above
  // never fires for this case, and dpiEnhanced would otherwise stay stuck
  // showing "Enhanced" even though the button is enabled again.
  useEffect(() => {
    if (needsDpiAttention && dpiEnhanced) setDpiEnhanced(false);
  }, [needsDpiAttention, dpiEnhanced]);

  const PT_TO_IN = 1 / 72;
  const isTooSmall = item.widthIn < 2 * PT_TO_IN || item.heightIn < 2 * PT_TO_IN;

  const hasFade = shouldWarn(transparency);

  /**
   * Hover explanation for a flagged image.
   *
   * The orange border says something is wrong but not what, and the banner is
   * about the sheet as a whole. On a sheet with several images this is the only
   * place that connects a specific image to a specific reason — and says what
   * to do about it.
   */
  const fadeMessage = hasFade && transparency ? transparencyMessage(transparency) : null;
  const fadeConfidence =
    transparency?.source === "ai" ? ` (${Math.round(transparency.confidence * 100)}% confident)` : "";
  const fadeTitle = fadeMessage ? `${fadeMessage.title}${fadeConfidence}: ${fadeMessage.body}` : undefined;

  // Priority: too-small (red) > fade (orange) > low/unknown-dpi (amber) > normal (blue)
  const borderColor = isTooSmall ? "#EF4444" : hasFade ? "#F97316" : needsDpiAttention ? "#EDAE00" : "#3b82f6";
  const borderColorHover = isTooSmall ? "#EF4444" : hasFade ? "#F97316" : needsDpiAttention ? "#EDAE00" : "#60a5fa";
  const handleColor = isTooSmall
    ? "bg-red-500"
    : hasFade
    ? "bg-orange-500"
    : needsDpiAttention
    ? "bg-[#EDAE00]"
    : "bg-blue-500";

  const effectiveMargin = marginSize;
  const gap = spacing;
  const maxAvailableWidth = canvasWidth - 2 * effectiveMargin;
  // When the layout engine assigned a 90° nest-rotation, width and height are
  // effectively swapped: the item occupies a heightIn-wide × widthIn-tall cell.
  const nestRot = item.nestRotation ?? 0;
  const scaledWidth  = nestRot === 90 ? item.heightIn : item.widthIn;
  const scaledHeight = nestRot === 90 ? item.widthIn  : item.heightIn;
  // item.rotation is baked into item.widthIn/heightIn already (rotateSelected
  // swaps them on every 90° click), so at 90°/270° the cell's own aspect ratio
  // is already the inverse of the source image's native aspect ratio. Sizing
  // the <img> to that swapped cell and then CSS-rotating it on top double-
  // counts the rotation: object-contain letterboxes the image down to fit the
  // (wrong-aspect) box *before* the rotate transform ever runs, so the visible
  // artwork renders smaller than it should. XOR with nestRot's own swap (which
  // needs the same correction, already handled below) tells us whether the
  // img element must be rendered at its natural (pre-swap) size and centered
  // via offset, or can be sized directly to the cell.
  const userRotationOdd = ((item.rotation / 90) % 2 + 2) % 2 === 1;
  const needsSwapRender = (nestRot === 90) !== userRotationOdd;
  const totalCssRotation = nestRot + item.rotation;
  const renderCopies = computeRenderCopies(
    { widthIn: scaledWidth, heightIn: scaledHeight, copies: item.copies },
    canvasWidth,
    effectiveMargin,
    gap,
  );

  // Flow geometry — provided by calculateGridLayout when items share a lane.
  // Otherwise fall back to a fully-packed grid (first cell at col 0).
  const hasFlow =
    typeof item.flowCols === "number" &&
    typeof item.flowStartCol === "number" &&
    typeof item.flowEndCol === "number";
  // Without a layout-assigned column count, wrap the way the footprint, the
  // billed length and the print export do. "As many as fit" made this the one
  // place that drew a copy group in a different shape from the other three.
  const flowCols = hasFlow
    ? Math.max(1, item.flowCols!)
    : computeGroupDims(scaledWidth, scaledHeight, Math.max(1, renderCopies), Math.max(1e-6, maxAvailableWidth), gap).cols;
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
              initialPos={panelInitialPos}
              onClose={onCloseProperties}
              onToggleAutoCrop={onToggleAutoCrop}
              onSetCopies={onSetCopies}
              onToggleLinked={onToggleLinked}
              onSetWidthIn={onSetWidthIn}
              onSetHeightIn={onSetHeightIn}
              onSetPosX={onSetPosX}
              onSetPosY={onSetPosY}
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
      title={fadeTitle}
      className="absolute rounded-md transition-shadow duration-300 ease-out"
      style={{
        left: `${clampedLeft * CANVAS.PIXELS_PER_INCH}px`,
        top: `${clampedTop * CANVAS.PIXELS_PER_INCH}px`,
        touchAction: "none",
        zIndex: isLifted ? 2000 : isSelected ? 1000 : item.copies > 1 ? 30 : 10,
        pointerEvents: "none",
        // Displacement preview: nudged out of the dragged item's way as a pure
        // transform. The transition only exists while a drag is active, so the
        // on-drop commit (left/top moves by exactly this offset while the
        // transform clears) swaps with zero visual movement — no snap-back.
        ...(previewOffset
          ? {
              transform: `translate(${previewOffset.dx * CANVAS.PIXELS_PER_INCH}px, ${previewOffset.dy * CANVAS.PIXELS_PER_INCH}px)`,
            }
          : null),
        ...(displacementActive
          ? {
              transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }
          : null),
      }}
    >
      {isPrimary && (() => {
        const portal = document.getElementById("artboard-toolbar-portal");
        if (!portal) return null;
        return createPortal(
          <ItemToolbar
            locked={item.locked}
            onGroup={onGroup}
            groupAction={groupAction}
            onRotate={onRotate}
            onToggleLock={onToggleLock}
            onFlip={onFlip}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onIncreaseDpi={handleIncreaseDpi}
            currentDpi={effectiveDpi ?? item.dpi}
            isDpiUnknown={isDpiUnknown}
            isDpiEnhancing={isDpiEnhancing}
            dpiProgress={dpiProgress}
            dpiEnhanced={dpiEnhanced}
            onRemoveBg={handleRemoveBg}
            bgStatus={bgStatus}
            isRemovingBg={isRemovingBg}
            bgProgress={bgProgress}
            bgJustRemoved={bgJustRemoved}
            onOpenAi={
              aiPanel
                ?() => (aiOpen ? aiPanel.onClose() : aiPanel.onOpen(item.id))
                : undefined
            }
            aiActive={aiOpen}
            selection={selection}
          />,
          portal,
        );
      })()}
      {aiOpen && aiPanel ? (
        <AiImagePanel
          anchorRef={itemRef}
          positionKey={`${item.posX},${item.posY},${zoom},${scrollTop}`}
          messages={aiPanel.messages}
          isRunning={aiPanel.isRunning}
          status={aiPanel.status}
          onSend={aiPanel.onSend}
          onCancel={aiPanel.onCancel}
          onClose={aiPanel.onClose}
          scrollContainerRef={scrollContainerRef}
          // Resolved by the bridge from the full artboard item — this
          // component's `item` prop is a narrower shape that carries neither
          // the cropped URL nor the AI history.
          imageUrl={aiPanel.imageUrl || item.url}
          editHistory={aiPanel.editHistory}
          onRevertHistory={aiPanel.onRevertHistory}
        />
      ) : null}
      {propertiesPortal}
      {/* Group Layout for Copies — virtual rows, absolute positioned */}
      <div
        className="relative"
        style={{
          width: `${groupWidthPx}px`,
          height: `${totalGroupHeightPx}px`,
          pointerEvents: "auto",
          clipPath: polygonClipPath,
          // iOS-style lift while dragging: scale up with a deep soft shadow,
          // springing back on release. Lives on this inner div so it never
          // collides with the outer container's transform (owned by the FLIP
          // settle animation and the displacement preview).
          transform: isLifted ? "scale(1.035)" : undefined,
          boxShadow: isLifted
            ? "0 18px 42px rgba(0,0,0,0.28), 0 6px 14px rgba(0,0,0,0.16)"
            : undefined,
          transformOrigin: "50% 50%",
          transition:
            "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 280ms ease",
        }}
        onMouseEnter={() => setIsHovered(true)}
        // Deliberately does NOT cancel the pending drag: on a fast flick the
        // mouseleave fires before the mousemove that would cross the 4px
        // activation threshold (boundary events precede the move event), which
        // silently killed the drag. The document-level move/up listeners the
        // pending drag installed clean themselves up on mouseup regardless.
        onMouseLeave={() => setIsHovered(false)}
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
            const renderElement = (
              <img
                key={index}
                /* crossOrigin before src: React sets attributes in order, and a
                   src set first starts a plain (non-CORS) download that the
                   browser caches. Every later CORS read of the same image — the
                   pixel measure behind the DPI check, the transparency check —
                   was then served that cached copy with no CORS header and
                   failed: a reloaded sheet showed broken images, "unknown DPI"
                   on every piece, and asked for re-uploads. */
                crossOrigin="anonymous"
                src={item.url}
                draggable={false}
                alt={`copy-${index}`}
                /* Decode off the main thread. A print-resolution PNG blocks
                   for tens of milliseconds when decoded synchronously, and a
                   sheet brings up many at once — that stall is what made
                   scrolling a busy board stutter. The browser keeps one
                   decoded copy per URL, so repeated copies of the same
                   artwork cost nothing extra. */
                decoding="async"
                /* Defers fetching for copies scrolled out of view. Harmless
                   for the visible ones, which the browser fetches eagerly
                   regardless, and identical URLs are served from cache. */
                loading="lazy"
                /* Until the artwork arrives the cell shows a placeholder, not
                   the browser's alt text over an empty box. */
                onLoad={(e) => {
                  e.currentTarget.dataset.loaded = "1";
                }}
                className={`object-contain touch-none text-transparent [&:not([data-loaded])]:bg-slate-300/50 [&:not([data-loaded])]:animate-pulse ${isLifted ? "cursor-grabbing" : "cursor-grab"} rounded-sm ${
                  isSelected && renderCopies > 1
                    ? `border ${isTooSmall ? "border-red-500" : hasFade ? "border-orange-500" : needsDpiAttention ? "border-[#EDAE00]" : "border-blue-500"}`
                    : ""
                }`}
                style={needsSwapRender ? (() => {
                  // The cell (scaledWidth × scaledHeight) uses effective (swapped) dims.
                  // The image element is sized to the ORIGINAL dims (scaledHeight × scaledWidth)
                  // and centered in the cell, then rotated 90° CW to fill it exactly.
                  // Math: center the origW×origH element so its centroid aligns with the
                  // cell centroid, then rotate — the visual bounding box becomes scaledWidth×scaledHeight.
                  // maxWidth must be lifted explicitly: Tailwind preflight's
                  // `img { max-width: 100% }` would clamp this deliberately
                  // wider-than-its-container element down to the cell width,
                  // letterboxing the artwork — the "rotation shrinks my image"
                  // bug. The visual footprint is still exactly one cell.
                  const offset = (scaledWidth - scaledHeight) * ppi / 2;
                  return {
                    position: "absolute" as const,
                    left: `${col * (scaledWidth + gap) * ppi + offset}px`,
                    top:  `${row * (scaledHeight + gap) * ppi - offset}px`,
                    width:  `${scaledHeight * ppi}px`,
                    height: `${scaledWidth  * ppi}px`,
                    maxWidth: "none" as const,
                    maxHeight: "none" as const,
                    transform: `scaleX(${item.flipped ? -1 : 1}) rotate(${totalCssRotation}deg)`,
                  };
                })() : {
                  position: "absolute",
                  left: `${col * (scaledWidth + gap) * ppi}px`,
                  top:  `${row * (scaledHeight + gap) * ppi}px`,
                  width:  `${scaledWidth  * ppi}px`,
                  height: `${scaledHeight * ppi}px`,
                  maxWidth: "none",
                  maxHeight: "none",
                  transform: `scaleX(${item.flipped ? -1 : 1}) rotate(${totalCssRotation}deg)`,
                }}
                /*
                 * Pointer events, not mouse events: the same handler then works
                 * for a finger, a stylus and a mouse. With `onMouseDown` a phone
                 * could select a piece but never move one — a touch drag scrolls
                 * the page and emits no mouse move at all.
                 */
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  dragActivatedRef.current = false;
                  cancelPendingDrag();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const THRESHOLD_SQ = 4 * 4;

                  const onMove = (moveEvt: PointerEvent) => {
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
                    document.removeEventListener("pointermove", onMove);
                    document.removeEventListener("pointerup", onUp);
                    document.removeEventListener("pointercancel", onUp);
                    pendingDragRef.current = null;
                  };
                  document.addEventListener("pointermove", onMove);
                  document.addEventListener("pointerup", onUp, { once: true });
                  document.addEventListener("pointercancel", onUp, { once: true });
                  pendingDragRef.current = cleanup;
                }}
              />
            );
            return renderElement;
          });
        })}
        {isRemovingBg && (
          <div className="absolute inset-0 z-20 pointer-events-none rounded-sm overflow-hidden">
            <div className="absolute inset-0 bg-slate-900 bg-removing-overlay" />
            <div
              className="absolute inset-x-0 bg-scan-beam"
              style={{
                height: "40%",
                background: "linear-gradient(to bottom, transparent, rgba(167,139,250,0.55), rgba(139,92,246,0.7), rgba(167,139,250,0.55), transparent)",
              }}
            />
          </div>
        )}
        {isDpiEnhancing && (
          <div className="absolute inset-0 z-20 pointer-events-none rounded-sm overflow-hidden">
            <div className="absolute inset-0 bg-amber-400 bg-removing-overlay" />
            <div
              className="absolute inset-x-0 bg-scan-beam"
              style={{
                height: "40%",
                background: "linear-gradient(to bottom, transparent, rgba(251,191,36,0.5), rgba(245,158,11,0.65), rgba(251,191,36,0.5), transparent)",
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
              {fadeMessage && (
                <>
                  <p className="text-[11px] leading-snug text-orange-600 font-semibold">
                    {fadeMessage.title}
                    {fadeConfidence}
                  </p>
                  <p className="text-[11px] leading-snug text-gray-700">{fadeMessage.body}</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {/*
        DPI highlight.

        Drawn on the same `polygonPathD` the selection outline uses, so it hugs
        the occupied cells of a copy-grid exactly rather than boxing the whole
        rectangle — on an item whose last row is partial, a plain box would
        outline empty sheet.

        Two strokes: a wide translucent halo that carries at a distance on a
        zoomed-out sheet, and a crisp line on top that stays legible up close.
        Both in `#EDAE00`, the amber this codebase already uses for DPI
        attention, so the highlight reads as "more of what the chip said"
        rather than a new signal to learn.

        Rendered *before* the selection outline so selecting a highlighted item
        still shows its normal blue, with the amber halo around it — the two
        states stack instead of one hiding the other.
      */}
      {isDpiHighlighted && (
        <svg
          className="dpi-highlight-outline absolute top-0 left-0 pointer-events-none"
          style={{ overflow: "visible" }}
          width={groupWidthPx}
          height={totalGroupHeightPx}
          aria-hidden
        >
          <path
            d={polygonPathD}
            fill="none"
            stroke="#EDAE00"
            strokeOpacity={0.28}
            strokeWidth={14}
            strokeLinejoin="round"
          />
          <path
            d={polygonPathD}
            fill="none"
            stroke="#EDAE00"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </svg>
      )}
      {/*
        Transparency flag.

        Always drawn, not only on hover or selection: artwork that will not print
        as it looks has to be findable on a busy sheet at a glance, including
        zoomed out. Drawn before the selection outline, which is the same orange
        for a flagged item, so selecting one changes nothing but the handles.
      */}
      {hasFade && (
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{ overflow: "visible" }}
          width={groupWidthPx}
          height={totalGroupHeightPx}
          aria-hidden
        >
          <path d={polygonPathD} fill="none" stroke="#F97316" strokeWidth={3} strokeLinejoin="round" />
        </svg>
      )}
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
            className={`absolute -top-2 -left-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white touch-none cursor-nwse-resize pointer-events-auto`}
            onPointerDown={onResizeStart}
          />
          <span
            className={`absolute -top-2 -right-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white touch-none cursor-nesw-resize pointer-events-auto`}
            onPointerDown={onResizeStart}
          />
          <span
            className={`absolute -bottom-2 -left-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white touch-none cursor-nesw-resize pointer-events-auto`}
            onPointerDown={onResizeStart}
          />
          <span
            className={`absolute -bottom-2 -right-2 w-3.5 h-3.5 rounded-full ${handleColor} border-2 border-white touch-none cursor-nwse-resize pointer-events-auto`}
            onPointerDown={onResizeStart}
          />
        </>
      )}
    </div>
  );
}

// Memoized so the per-frame setItems during a drag only re-renders the items
// whose props actually changed (the dragged one, plus any displaced
// neighbors) instead of the whole sheet — this is what keeps large gang
// sheets at frame rate. Function props are deliberately excluded from the
// comparison: they're recreated inline on every parent render, and every
// piece of state their closures depend on (the item itself, selection,
// scroll, zoom, drag visuals) is covered by the value props compared here,
// so any behaviorally meaningful change still re-renders. Handlers that need
// always-fresh item positions read them through refs (see
// useMouseInteractions.itemsRef) rather than trusting closure freshness.
export default React.memo(ArtboardItem, (prev, next) => {
  const keys = Object.keys(next) as Array<keyof ArtboardItemProps>;
  for (const key of keys) {
    const a = prev[key];
    const b = next[key];
    if (typeof b === "function" && typeof a === "function") continue;
    if (key === "previewOffset") {
      const po = a as ArtboardItemProps["previewOffset"];
      const no = b as ArtboardItemProps["previewOffset"];
      if (!!po !== !!no) return false;
      if (po && no && (Math.abs(po.dx - no.dx) > 1e-4 || Math.abs(po.dy - no.dy) > 1e-4)) return false;
      continue;
    }
    if (!Object.is(a, b)) return false;
  }
  return true;
});
