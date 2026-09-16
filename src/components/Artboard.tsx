import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  useItemActions,
  useMouseInteractions,
  useDropHandler,
  useCanvasWidth,
  useArtboardEffects,
  useHistory,
  useAiEdit,
  useAiConversation,
  useMaterializeImages,
  useTransparencyVerdicts,
} from "./artboard/lib/hooks";
import { snapToGridPoint, isDpiFlagged, shouldWarn, type FadeVerdict } from "./artboard/lib/utils";
import { isTypingTarget } from "../lib/utils/keyboard";
import { ArtboardWarning, CanvasContainer } from "./artboard/features/canvas";
import { ZoomControls } from "./artboard/features/zoom";
import { AiPreviewDialog } from "./artboard/features/ai";
import type { AiPanelBridge } from "./artboard/features/ai";
import type { BoardCommand } from "./artboard/lib/ai";
import { executeBoardCommands } from "./artboard/lib/ai";
import type { ArtboardProps } from "./artboard/types";
import { CANVAS, MAX_SHEET_HEIGHT_IN, UPLOAD_ACCEPT_ATTRIBUTE, ZOOM } from "../config/artboard.config";
import { DEFAULT_EDITOR_SETTINGS } from "../lib/utils/editorSettings";
import { isSheetFull } from "./artboard/lib/utils";

export default function Artboard({
  onHeaderInfoChange,
  onActionPerformed,
  // One set of defaults. These disagreed with the editor's (0.25in margin,
  // auto-nest off, 0.5in spacing), so a caller omitting a prop got a different
  // sheet from the one the editor starts.
  showRulers = DEFAULT_EDITOR_SETTINGS.showRulers,
  showGrid = DEFAULT_EDITOR_SETTINGS.showGrid,
  snapToGrid = DEFAULT_EDITOR_SETTINGS.snapToGrid,
  showMargins = DEFAULT_EDITOR_SETTINGS.showMargins,
  marginSize = DEFAULT_EDITOR_SETTINGS.marginSize,
  autoNestStickers = DEFAULT_EDITOR_SETTINGS.autoNestStickers,
  spacing = DEFAULT_EDITOR_SETTINGS.spacing,
  canvasBg = DEFAULT_EDITOR_SETTINGS.canvasBg,
  autoCropUploads = DEFAULT_EDITOR_SETTINGS.autoCropUploads,
  shortcutsEnabled = true,
  highlightLowDpi = false,
  onRequestAutoNest,
  onUpdateSetting,
  onDataChange,
  initialData,
  onAddToCart,
  onHistoryChange,
}: ArtboardProps) {
  const [zoom, setZoom] = useState(1);
  const [items, setItems] = useState<any[]>([]);
  const [counter, setCounter] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showProperties, setShowProperties] = useState<Record<number, boolean>>(
    {},
  );
  const [addedToCart, setAddedToCart] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /*
   * Escape clears the selection, the standard way out of one. Panels that own
   * Escape (the AI panel, the edit preview) stop it in the capture phase, so
   * pressing it there closes the panel and leaves the selection alone.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      setSelectedId(null);
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
      setShowProperties((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Auto-nest on and off, without opening the sidebar.
   *
   * Turning it on re-nests the whole sheet, which is the one-press way to pull a
   * hand-arranged board back into the shortest layout. Shared by the "N"
   * shortcut and the canvas's right-click menu, and said out loud either way:
   * the change is to the whole board, so it should never be silent.
   */
  const toggleAutoNest = useCallback(() => {
    const next = !autoNestStickers;
    onRequestAutoNest?.(next);
    toast.success(
      next ? "Auto-nest on — artwork re-nested into the shortest sheet" : "Auto-nest off — artwork stays where you put it",
      { id: "auto-nest-toggle" },
    );
  }, [autoNestStickers, onRequestAutoNest]);

  /* "N" nests, the way double-clicking the sheet adds artwork. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (!shortcutsEnabled || isTypingTarget(e.target)) return;
      e.preventDefault();
      toggleAutoNest();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleAutoNest, shortcutsEnabled]);

  const canvasWidth = useCanvasWidth();

  // Explicit zoom, set through the AI command box or the zoom controls. While
  // null the board keeps auto-fitting to the container, which is the default
  // and what "zoom to fit" restores — pinning a number on first load would
  // break the responsive behaviour the artboard has always had.
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);

  // Auto-fit the roll's width into the visible area at browser zoom 100%.
  useEffect(() => {
    const el = document.querySelector("#artboard-main-container") as HTMLElement | null;
    if (!el) return;

    const neededPx = canvasWidth * CANVAS.PIXELS_PER_INCH;
    if (!neededPx) return;

    const update = () => {
      // An explicit zoom wins over the fit, but the observer stays attached so
      // returning to fit later picks up whatever size the window is by then.
      if (zoomOverride != null) {
        setZoom(zoomOverride);
        return;
      }
      const availablePx = Math.max(0, el.clientWidth - CANVAS.RULER_OFFSET_PX);
      const fit = availablePx / neededPx;
      setZoom(Math.min(1, Math.max(0.1, fit || 1)));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoomOverride, canvasWidth]);

  /**
   * Applies an explicit zoom, or `null` to resume auto-fit. Returns the value
   * actually used so the caller can report clamping honestly.
   */
  const applyZoom = useCallback((factor: number | null): number => {
    if (factor == null) {
      setZoomOverride(null);
      const el = document.querySelector("#artboard-main-container") as HTMLElement | null;
      const neededPx = canvasWidth * CANVAS.PIXELS_PER_INCH;
      const availablePx = Math.max(0, (el?.clientWidth ?? 0) - CANVAS.RULER_OFFSET_PX);
      return Math.min(1, Math.max(0.1, availablePx / neededPx || 1));
    }
    const clamped = Math.min(ZOOM.MAX, Math.max(ZOOM.MIN, factor));
    setZoomOverride(clamped);
    return clamped;
  }, [canvasWidth]);
  /**
   * Uploads canvas-produced artwork in the background, as soon as it appears.
   *
   * Keeps items holding short URLs rather than megabytes of base64, so the
   * cart sync, design save and order request are all small — and Place Order
   * has no artwork left to transmit.
   */
  useMaterializeImages(items, setItems);

  const history = useHistory(items, setItems);

  // Bubble history state up to parent (Editor → Header)
  useEffect(() => {
    onHistoryChange?.({
      undo: history.undo,
      redo: history.redo,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  }, [history.undo, history.redo, history.canUndo, history.canRedo, onHistoryChange]);

  const {
    isDragging,
    isUploading,
    uploadProgress,
    uploadFileName,
    batchLoaded,
    batchTotal,
    queuedCount,
    cancelUploads,
    dropFilesAtCenter,
    onDragOver,
    onDragLeave,
    onDropEvent,
  } =
    useDropHandler(
      items,
      setItems,
      counter,
      setCounter,
      setSelectedId,
      canvasWidth,
      zoom,
      autoNestStickers,
      onRequestAutoNest,
      spacing,
      marginSize,
      history.commit,
      autoCropUploads,
    );
  const transparencyVerdicts = useTransparencyVerdicts(items);

  /**
   * One verdict per flagged file on the board, for the banner. Counted by file,
   * not by piece: duplicates of one image share it, and the banner's instruction
   * is to update the file — two copies of one image are one file to fix.
   */
  const flaggedTransparency = useMemo(() => {
    const flagged = new Map<string, FadeVerdict>();
    for (const it of items) {
      const verdict = transparencyVerdicts.get(it.url);
      if (verdict && shouldWarn(verdict)) flagged.set(it.url, verdict);
    }
    return [...flagged.values()];
  }, [items, transparencyVerdicts]);

  /**
   * The items the DPI chip is counting.
   *
   * Derived with `computeEffectiveDpi` — the same function `useArtboardEffects`
   * uses to produce the chip's number — so what lights up on the sheet always
   * matches what the chip says. `ArtboardItem` measures its own DPI from the
   * loaded `<img>`, which is right for its own amber border but can differ by a
   * pixel or two mid-load; trusting that here would let a chip reading "5"
   * highlight four.
   *
   * Empty (and cheap) whenever the highlight is off, so the ordinary render
   * path pays a single boolean check rather than a pass over the board.
   */
  const dpiHighlightIds = useMemo(() => {
    if (!highlightLowDpi) return null;
    const flagged = new Set<number>();
    // Both halves of the chip's count: measurably low, and unmeasurable.
    for (const it of items) {
      if (isDpiFlagged(it)) flagged.add(it.id);
    }
    return flagged.size > 0 ? flagged : null;
  }, [highlightLowDpi, items]);

  const itemActions = useItemActions(
    items,
    setItems,
    selectedId,
    snapToGrid,
    snapToGridPoint,
    canvasWidth,
    marginSize,
    spacing,
    onActionPerformed,
    history.commit,
  );
  const {
    handleResizeStart,
    handleDragStart,
    isDraggingItem,
    isResizing,
    liftedIds,
    previewOffsets,
    dropIndicator,
  } = useMouseInteractions(
    items,
    setItems,
    selectedId,
    zoom,
    snapToGrid,
    snapToGridPoint,
    autoNestStickers,
    canvasWidth,
    marginSize,
    spacing,
    history.commit,
    onRequestAutoNest,
    setSelectedId,
    setSelectedIds,
    selectedIds,
  );

  useArtboardEffects(
    items,
    setItems,
    selectedId,
    snapToGrid,
    canvasWidth,
    spacing,
    autoNestStickers,
    marginSize,
    isDraggingItem,
    isResizing,
    showRulers,
    onHeaderInfoChange,
    initialData,
    onDataChange,
    counter,
  );

  useEffect(() => {
    const initItems = Array.isArray(initialData?.items) ? initialData.items : [];
    if (initItems.length) {
      const maxId = initItems.reduce(
        (m: number, it: any) => Math.max(m, Number(it?.id) || 0),
        0,
      );
      const initCounter =
        typeof initialData?.counter === "number" ? initialData.counter : 0;
      const target = Math.max(maxId, initCounter);
      setCounter((prev) => (prev < target ? target : prev));
    }
    // Loading a different design discards prior history — those steps no longer make sense
    history.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  // AI editing targets: every selected item still on the board. Every item is a
  // raster image — PDFs are rendered to PNG pages before they are placed.
  const aiTargetIds = useMemo(() => {
    const ids = new Set<number>(selectedIds);
    if (selectedId != null) ids.add(selectedId);
    return items.filter((it) => ids.has(it.id)).map((it) => it.id);
  }, [items, selectedId, selectedIds]);

  const ai = useAiEdit(
    items,
    setItems,
    aiTargetIds,
    history.commit,
    onActionPerformed,
  );

  // Everything the executor reads goes through a ref so `runBoardCommands` keeps
  // a stable identity — otherwise the conversation's `send` handler, and the
  // panel that holds it, would be rebuilt on every item change mid-drag.
  const boardStateRef = useRef({
    items, selectedId, selectedIds, canvasWidth, marginSize, spacing, zoom, history, itemActions,
  });
  boardStateRef.current = {
    items, selectedId, selectedIds, canvasWidth, marginSize, spacing, zoom, history, itemActions,
  };

  const runBoardCommands = useCallback(async (commands: BoardCommand[]) => {
    const state = boardStateRef.current;
    return executeBoardCommands(commands, {
      getContext: () => {
        const current = boardStateRef.current;
        const ids = new Set<number>(current.selectedIds);
        if (current.selectedId != null) ids.add(current.selectedId);
        return {
          items: current.items,
          // Deliberately no "apply to everything when nothing is selected"
          // fallback — that would turn "delete this" on an empty selection into
          // a wipe of the whole sheet.
          targetIds: current.items.filter((it) => ids.has(it.id)).map((it) => it.id),
          canvasWidth: current.canvasWidth,
          marginSize: current.marginSize,
          spacing: current.spacing,
          zoom: current.zoom,
        };
      },
      setItems,
      commitHistory: () => boardStateRef.current.history.commit(),
      undo: () => boardStateRef.current.history.undo(),
      redo: () => boardStateRef.current.history.redo(),
      canUndo: state.history.canUndo,
      canRedo: state.history.canRedo,
      select: (ids) => {
        setSelectedIds(new Set(ids));
        setSelectedId(ids.length ? ids[ids.length - 1] : null);
      },
      // Delegated rather than reimplemented: auto-crop does real image work
      // (server trim, or a canvas alpha/border scan) and only ever applies to
      // the primary selection, so a no-op is reported honestly as a no-op.
      toggleAutoCrop: async (value: boolean) => {
        const current = boardStateRef.current;
        const item = current.items.find((it) => it.id === current.selectedId);
        if (!item || Boolean(item.autoCrop) === value) return;
        await current.itemActions.toggleAutoCrop();
      },
      setZoom: applyZoom,
      updateSetting: (key, value) => {
        // autoNest has a dedicated channel that also re-runs the layout pass.
        if (key === "autoNestStickers") onRequestAutoNest?.(Boolean(value));
        else onUpdateSetting?.(key, value);
      },
      notifyAction: onActionPerformed,
    });
    // history.canUndo/canRedo are read from the render-time snapshot above, so
    // they belong in the dep list; everything else is reached through the ref.
  }, [onActionPerformed, onRequestAutoNest, onUpdateSetting, applyZoom, history.canUndo, history.canRedo]);

  const aiConversation = useAiConversation(ai.generate, runBoardCommands);

  // Which item's contextual AI panel is open (null = none). Holding it here — a
  // single value, above every item — is what guarantees only one panel is ever
  // open at a time.
  const [aiPanelItemId, setAiPanelItemId] = useState<number | null>(null);

  // Close the panel (and cancel any run) whenever the primary selection changes
  // or the item disappears, so a stale panel can never linger on a deselected
  // or deleted image. Opening for a fresh image starts a clean transcript.
  useEffect(() => {
    if (aiPanelItemId != null && aiPanelItemId !== selectedId) {
      setAiPanelItemId(null);
      ai.cancel();
    }
    // Only the selection change should trigger this; reading the latest
    // aiPanelItemId/ai from the closure is exactly what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // The item the panel is open for, resolved once here so the bridge can carry
  // its image and edit chain without the panel needing to look items up.
  const aiPanelItem = aiPanelItemId != null ? items.find((it) => it.id === aiPanelItemId) : undefined;

  const aiPanel: AiPanelBridge = {
    openItemId: aiPanelItemId,
    isRunning: ai.isRunning,
    status: ai.status,
    messages: aiConversation.messages,
    onOpen: (id) => {
      aiConversation.clear();
      setAiPanelItemId(id);
    },
    onClose: () => {
      ai.cancel();
      // A staged edit belongs to the panel session — leaving it behind would
      // pop the review dialog back up over a closed panel with no context.
      ai.discardPreview();
      setAiPanelItemId(null);
    },
    onSend: aiConversation.send,
    onCancel: ai.cancel,
    imageUrl: aiPanelItem?.croppedUrl || aiPanelItem?.url,
    editHistory: aiPanelItem?.aiHistory,
    onRevertHistory: (entryIndex) => {
      if (aiPanelItemId == null) return;
      ai.revertToHistoryEntry(aiPanelItemId, entryIndex);
    },
  };

  const duplicateSelected = () => {
    if (selectedId == null) return;
    if (isSheetFull(items as any)) {
      toast.error(
        `Sheet is full — the maximum length of ${MAX_SHEET_HEIGHT_IN.toLocaleString()}in has been reached. Remove artwork to add more.`,
      );
      return;
    }
    const target = items.find((it) => it.id === selectedId);
    if (!target) return;
    history.commit();
    const newId = counter + 1;
    setCounter(newId);
    const copy = {
      ...target,
      id: newId,
      posX: target.posX + 0.5,
      posY: target.posY + 0.5,
      gravityActive: true,
    };
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.id === selectedId);
      const next = [...prev];
      next.splice(idx === -1 ? next.length : idx + 1, 0, copy);
      return next;
    });
    // The copy alone is selected. Setting only the primary left the original in
    // the multi-selection too, so both showed handles.
    setSelectedId(newId);
    setSelectedIds(new Set([newId]));
  };

  const handleLinkSelected = () => {
    const selectedItems = items.filter(
      (it) => selectedIds.has(it.id) || it.id === selectedId,
    );
    // De-dupe by ID
    const uniqueSelected = Array.from(
      new Map(selectedItems.map((item) => [item.id, item])).values(),
    );

    if (uniqueSelected.length < 2) return;

    // Check if all are the same image URL
    const firstUrl = uniqueSelected[0].url;
    const allSame = uniqueSelected.every((it) => it.url === firstUrl);

    if (allSame) {
      history.commit();
      const totalCopies = uniqueSelected.reduce(
        (sum, it) => sum + it.copies,
        0,
      );
      const primary = uniqueSelected[0];

      const mergedItem = {
        ...primary,
        copies: totalCopies,
        id: Date.now(),
        linked: false, // Reset link state
      };

      const selectedIdSet = new Set(uniqueSelected.map((it) => it.id));
      const remainingItems = items.filter((it) => !selectedIdSet.has(it.id));

      setItems([...remainingItems, mergedItem]);
      setSelectedId(mergedItem.id);
      setSelectedIds(new Set([mergedItem.id]));
    }
  };

  return (
    <div
      id="artboard-main-container"
      className="flex-1 relative bg-gray-50 overflow-hidden flex flex-col artboard-capture-area"
      style={{ userSelect: isResizing || isDraggingItem ? "none" : "auto" }}
    >
      {/* Resolution is no longer routed through here — it is raised as a toast
          when a drop lands (`showLowDpiWarning`) and reported continuously by
          the top-bar chip, so this banner is now purely about fades. */}
      <ArtboardWarning flagged={flaggedTransparency} />
      <input
        ref={fileInputRef}
        type="file"
        // Same list the drop filter uses. These had drifted: PDF was accepted
        // when dragged but absent here, so browsing could not select a file
        // the artboard would happily have taken.
        accept={UPLOAD_ACCEPT_ATTRIBUTE}
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = e.target.files;
          if (files && files.length) {
            await dropFilesAtCenter(files);
          }
          e.target.value = "";
        }}
      />
      <div className="flex-1 flex overflow-hidden">
        <CanvasContainer
          zoom={zoom}
          showRulers={showRulers}
          // Was destructured here and passed to nothing — the toggle's whole
          // journey ended at this component.
          showGrid={showGrid}
          showMargins={showMargins}
          marginSize={marginSize}
          spacing={spacing}
          autoNestStickers={autoNestStickers}
          canvasBg={canvasBg}
          canvasWidth={canvasWidth}
          isDragging={isDragging}
          isResizing={isResizing}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          uploadFileName={uploadFileName}
          batchLoaded={batchLoaded}
          batchTotal={batchTotal}
          queuedCount={queuedCount}
          dpiHighlightIds={dpiHighlightIds}
          transparencyVerdicts={transparencyVerdicts}
          onCancelUpload={cancelUploads}
          onBrowseFiles={() => fileInputRef.current?.click()}
          items={items}
          selectedId={selectedId}
          selectedIds={selectedIds}
          showProperties={showProperties}
          addedToCart={addedToCart}
          onWheel={(e) => {
            // Zoom disabled
            if (e.ctrlKey || e.metaKey) e.preventDefault();
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDropEvent}
          onCanvasClick={() => {
            setSelectedId(null);
            setSelectedIds(new Set());
            setShowProperties({});
          }}
          onItemSelect={(id, multi) => {
            if (multi) {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
              setSelectedId(id); // Update primary focus to latest clicked
            } else {
              setSelectedId(id);
              setSelectedIds(new Set([id]));
            }
            setShowProperties({});
          }}
          onToggleProperties={(id) =>
            setShowProperties((prev) => ({ ...prev, [id]: true }))
          }
          itemActions={itemActions}
          onLink={handleLinkSelected}
          onDuplicate={duplicateSelected}
          onDelete={() => {
            itemActions.deleteSelected();
            setSelectedId(null);
            setSelectedIds(new Set());
          }}
          onAddToCart={(it) => {
            if (onAddToCart && !addedToCart.has(it.id)) {
              onAddToCart({
                id: it.id,
                name: it.name,
                widthIn: it.widthIn,
                heightIn: it.heightIn,
                copies: it.copies,
                price: it.price,
                url: it.url,
              });
              setAddedToCart((prev) => new Set(prev).add(it.id));
            }
          }}
          onCloseProperties={() => setShowProperties({})}
          onRemoveBg={itemActions.removeBg}
          onDragStart={handleDragStart}
          onResizeStart={handleResizeStart}
          isDraggingItem={isDraggingItem}
          liftedIds={liftedIds}
          previewOffsets={previewOffsets}
          dropIndicator={dropIndicator}
          aiPanel={aiPanel}
        />
        {/* Mounted so an AI-driven zoom is visible and reversible in the UI —
            the requirement is that every control reflects the current state,
            and until now the zoom readout existed but was never rendered. */}
        <ZoomControls
          zoom={zoom}
          onZoomIn={() => applyZoom(zoom + ZOOM.STEP * 2)}
          onZoomOut={() => applyZoom(zoom - ZOOM.STEP * 2)}
          onZoomFit={() => applyZoom(null)}
          isFit={zoomOverride === null}
        />
      </div>

      {/* Review gate for a finished edit. Portalled from the component itself,
          so it renders over the whole editor rather than inside the canvas —
          judging a generative result needs the image at a useful size, which is
          the entire reason this is a dialog and not an inline thumbnail. */}
      {ai.preview && (
        <AiPreviewDialog
          preview={ai.preview}
          isRunning={ai.isRunning}
          onApply={ai.applyPreview}
          onDiscard={ai.discardPreview}
          // Re-sends the original prompt rather than the per-step rewrites: the
          // customer is asking for another sample of what they asked for, and
          // re-planning may also read the request better the second time.
          onRetry={() => {
            const { prompt } = ai.preview!;
            ai.discardPreview();
            aiConversation.send(prompt);
          }}
        />
      )}
    </div>
  );
}
