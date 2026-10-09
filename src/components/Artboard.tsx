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
import { snapToGridPoint, isDpiFlagged, shouldWarn } from "./artboard/lib/utils";
import { isNotUploaded } from "./artboard/lib/utils/uploadRecovery";
import FailedUploadsPanel from "./artboard/features/canvas/FailedUploadsPanel";
import { failedUploads } from "../lib/failedUploads";
import { isTypingTarget } from "../lib/utils/keyboard";
import { useCanHover } from "../lib/useIsMobile";
import { CanvasContainer } from "./artboard/features/canvas";
import { ZoomControls } from "./artboard/features/zoom";
import { AiPreviewDialog } from "./artboard/features/ai";
import type { AiPanelBridge } from "./artboard/features/ai";
import type { BoardCommand } from "./artboard/lib/ai";
import { executeBoardCommands } from "./artboard/lib/ai";
import type { ArtboardProps } from "./artboard/types";
import { CANVAS, MAX_SHEET_HEIGHT_IN, UPLOAD_ACCEPT_ATTRIBUTE, ZOOM } from "../config/artboard.config";
import { DEFAULT_EDITOR_SETTINGS } from "../lib/utils/editorSettings";
import { autoNestWouldUndoRotation, isSheetFull } from "./artboard/lib/utils";

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
  issueFocus = null,
  onTransparencyCounts,
  onNotUploadedCount,
  onRequestAutoNest,
  onUpdateSetting,
  onDataChange,
  initialData,
  onHistoryChange,
}: ArtboardProps) {
  /** No hovering pointer: a phone or tablet, where there is no keyboard to press. */
  const isTouch = !useCanHover();
  const [zoom, setZoom] = useState(1);
  const [items, setItems] = useState<any[]>([]);
  const [counter, setCounter] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showProperties, setShowProperties] = useState<Record<number, boolean>>(
    {},
  );
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
      const availablePx = Math.max(0, el.clientWidth - (showRulers ? CANVAS.RULER_OFFSET_PX : 0));
      const fit = availablePx / neededPx;
      setZoom(Math.min(1, Math.max(0.1, fit || 1)));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoomOverride, canvasWidth, showRulers]);

  /**
   * Applies an explicit zoom, or `null` to resume auto-fit. Returns the value
   * actually used so the caller can report clamping honestly.
   */
  const applyZoom = useCallback((factor: number | null): number => {
    if (factor == null) {
      setZoomOverride(null);
      const el = document.querySelector("#artboard-main-container") as HTMLElement | null;
      const neededPx = canvasWidth * CANVAS.PIXELS_PER_INCH;
      const availablePx = Math.max(0, (el?.clientWidth ?? 0) - (showRulers ? CANVAS.RULER_OFFSET_PX : 0));
      return Math.min(1, Math.max(0.1, availablePx / neededPx || 1));
    }
    const clamped = Math.min(ZOOM.MAX, Math.max(ZOOM.MIN, factor));
    setZoomOverride(clamped);
    return clamped;
  }, [canvasWidth, showRulers]);
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
   * The pieces whose transparency won't print as shown, in reading order, with
   * how many of each kind. Counted by piece, like the DPI chip: the chip's
   * number is also how many stops its click steps through.
   */
  const transparencyFlags = useMemo(() => {
    const ids: number[] = [];
    let fade = 0;
    let seeThrough = 0;
    for (const it of [...items].sort((a, b) => a.posY - b.posY || a.posX - b.posX)) {
      const verdict = transparencyVerdicts.get(it.url);
      if (!verdict || !shouldWarn(verdict)) continue;
      ids.push(it.id);
      if (verdict.kind === "translucent" || verdict.kind === "semi-transparent") seeThrough += 1;
      else fade += 1;
    }
    return { ids, fade, seeThrough };
  }, [items, transparencyVerdicts]);

  useEffect(() => {
    onTransparencyCounts?.({ fade: transparencyFlags.fade, seeThrough: transparencyFlags.seeThrough });
  }, [transparencyFlags.fade, transparencyFlags.seeThrough, onTransparencyCounts]);

  /**
   * The items the DPI chip is counting, always outlined on the sheet.
   *
   * Derived with `computeEffectiveDpi` — the same function `useArtboardEffects`
   * uses to produce the chip's number — so what is outlined always matches what
   * the chip says. `ArtboardItem` measures its own DPI from the loaded `<img>`,
   * which can differ by a pixel or two mid-load; trusting that here would let a
   * chip reading "5" outline four.
   */
  const dpiFlags = useMemo(() => {
    const ids = [...items]
      .filter(isDpiFlagged)
      .sort((a, b) => a.posY - b.posY || a.posX - b.posX)
      .map((it) => it.id);
    return { ids, set: ids.length > 0 ? new Set(ids) : null };
  }, [items]);

  /**
   * Images placed from the customer's file whose upload never succeeded, in
   * reading order. They are on the board and can be worked on, but exist only
   * in this browser until they upload.
   */
  const notUploaded = useMemo(
    () => [...items].filter(isNotUploaded).sort((a, b) => a.posY - b.posY || a.posX - b.posX),
    [items],
  );
  const notUploadedIds = useMemo(() => new Set(notUploaded.map((it) => it.id)), [notUploaded]);
  useEffect(() => {
    // An image deleted, or uploaded at last, has nothing left to retry.
    failedUploads.keepOnly(notUploadedIds);
    onNotUploadedCount?.(notUploadedIds.size);
  }, [notUploadedIds, onNotUploadedCount]);

  /**
   * Going to an issue: each chip click selects the next affected piece and
   * brings it into view, wrapping at the end. Selecting it puts its tools —
   * Enhance, the transparency note — right where the customer is looking.
   */
  const [issueTarget, setIssueTarget] = useState<{ id: number; nonce: number } | null>(null);
  const lastIssueStopRef = useRef<Record<"dpi" | "transparency" | "upload", number | null>>({
    dpi: null,
    transparency: null,
    upload: null,
  });
  const uploadIssueIds = notUploaded.map((it) => it.id);
  const issueListsRef = useRef({ dpi: dpiFlags.ids, transparency: transparencyFlags.ids, upload: uploadIssueIds });
  issueListsRef.current = { dpi: dpiFlags.ids, transparency: transparencyFlags.ids, upload: uploadIssueIds };
  const issueNonceRef = useRef(0);
  /** Selects one piece and brings it into view. */
  const showItem = (id: number) => {
    setSelectedId(id);
    setSelectedIds(new Set([id]));
    // Above any chip's own counter, so this always reads as a new request.
    setIssueTarget({ id, nonce: 1_000_000 + (issueNonceRef.current += 1) });
  };
  const removeItems = (ids: number[]) => {
    const gone = new Set(ids);
    history.commit();
    setItems((prev) => prev.filter((it) => !gone.has(it.id)));
    if (selectedId != null && gone.has(selectedId)) setSelectedId(null);
    setSelectedIds((prev) => new Set([...prev].filter((id) => !gone.has(id))));
  };
  useEffect(() => {
    if (!issueFocus) return;
    const ids = issueListsRef.current[issueFocus.kind];
    if (ids.length === 0) return;
    const last = lastIssueStopRef.current[issueFocus.kind];
    const next = ids[(last === null ? 0 : ids.indexOf(last) + 1) % ids.length];
    lastIssueStopRef.current[issueFocus.kind] = next;
    setSelectedId(next);
    setSelectedIds(new Set([next]));
    setIssueTarget({ id: next, nonce: issueFocus.nonce });
  }, [issueFocus]);

  const itemActions = useItemActions(
    items,
    setItems,
    selectedId,
    selectedIds,
    snapToGrid,
    snapToGridPoint,
    canvasWidth,
    marginSize,
    spacing,
    onActionPerformed,
    history.commit,
  );

  /**
   * Deletes the selection. Selection is only cleared when something went —
   * locked pieces stay, and stay selected so it is clear which ones they are.
   */
  const deleteSelection = useCallback(() => {
    const removed = itemActions.deleteSelected();
    if (removed > 0) {
      setSelectedId(null);
      setSelectedIds(new Set());
    }
  }, [itemActions]);

  /*
   * Delete and Backspace remove the selection — what every design tool does.
   * There was no keyboard delete at all.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (!shortcutsEnabled || isTypingTarget(e.target)) return;
      if (selectedId == null && selectedIds.size === 0) return;
      e.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection, shortcutsEnabled, selectedId, selectedIds]);

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
    history.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  // AI image edits apply to one image: the one the panel is open on, which is
  // always the primary selection (the panel closes when the primary changes).
  // Board commands typed into the panel still act on the whole selection.
  const ai = useAiEdit(
    items,
    setItems,
    selectedId,
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
        // Keep the current primary when it is still selected, so "select all"
        // typed into an image's AI panel doesn't close that panel.
        const current = boardStateRef.current.selectedId;
        setSelectedId(ids.length ? (current != null && ids.includes(current) ? current : ids[ids.length - 1]) : null);
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
  // (Shift-clicking another image closes it too — that click lands outside it.)
  useEffect(() => {
    if (aiPanelItemId != null && aiPanelItemId !== selectedId) {
      setAiPanelItemId(null);
      // Both halves: a prompt still being read would otherwise carry on and
      // edit whichever image is selected now.
      aiConversation.stopThinking();
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
    isRunning: ai.isRunning || aiConversation.isThinking,
    status: ai.status,
    messages: aiConversation.messages,
    onOpen: (id) => {
      aiConversation.clear();
      setAiPanelItemId(id);
    },
    onClose: () => {
      aiConversation.stopThinking();
      ai.cancel();
      // A staged edit belongs to the panel session — leaving it behind would
      // pop the review dialog back up over a closed panel with no context.
      ai.discardPreview();
      setAiPanelItemId(null);
    },
    onSend: aiConversation.send,
    onCancel: () => {
      aiConversation.stopThinking();
      ai.cancel();
    },
    imageUrl: aiPanelItem?.croppedUrl || aiPanelItem?.url,
    editHistory: aiPanelItem?.aiHistory,
    onRevertHistory: (entryIndex) => {
      if (aiPanelItemId == null) return;
      ai.revertToHistoryEntry(aiPanelItemId, entryIndex);
    },
  };

  /**
   * Rotate, unless auto-nest would turn the piece straight back.
   *
   * Auto-nest lays each piece whichever way uses the least film, so a quarter
   * turn it disagrees with was undone on the next layout pass — the footprint
   * stayed put and the artwork flipped upside down. The turn is tried on a copy
   * of the board first; if auto-nest would undo it, nothing changes and the
   * customer is told to switch auto-nest off to rotate. Everything else about
   * auto-nest is exactly as before.
   */
  const rotateSelected = () => {
    if (autoNestStickers) {
      const state = boardStateRef.current;
      const selected = new Set<number>(state.selectedIds);
      if (state.selectedId != null) selected.add(state.selectedId);
      // Locked pieces are refused by the action itself; groups are never
      // turned by auto-nest, so neither can conflict.
      const loose = new Set(
        state.items.filter((it) => selected.has(it.id) && !it.locked && !it.groupId).map((it) => it.id),
      );
      if (autoNestWouldUndoRotation(state.items, loose, state.canvasWidth, state.spacing, state.marginSize)) {
        /*
         * Short, and it goes away when tapped.
         *
         * It ran for six seconds with no way to dismiss it, sitting over the
         * toolbar on a phone — long enough to feel stuck. It also said "press
         * N", which a phone has no way to do.
         */
        toast(
          (t) => (
            <span onClick={() => toast.dismiss(t.id)} className="cursor-pointer">
              Auto-nest is keeping this piece turned to save film. Turn auto-nest off
              {isTouch ? " in the menu" : " (press N)"} to rotate it.
            </span>
          ),
          {
            id: "rotate-auto-nest",
            icon: "↻",
            duration: 3500,
            // Clear of the image toolbar, which sits at the top of the sheet.
            position: "bottom-center",
          },
        );
        return;
      }
    }
    itemActions.rotateSelected();
  };

  /**
   * Stores a piece's measured pixel width when it has none. Not an edit: no
   * undo step, and the sheet's saved/cart comparison ignores this field.
   */
  const recordMeasuredWidth = useCallback((id: number, widthPx: number, heightPx?: number, url?: string) => {
    setItems((prev) => {
      const item = prev.find((it) => it.id === id);
      if (!item) return prev;
      const needsWidth = !item.nativeWidthPx && !item.croppedWidthPx;
      // The image's real size, for the DPI check's second axis. Tied to the
      // image it was read from, so it is never applied to a later one.
      const needsShape =
        Boolean(url) && Boolean(heightPx) && item.url === url &&
        (item.measuredUrl !== url || item.measuredWidthPx !== widthPx || item.measuredHeightPx !== heightPx);
      if (!needsWidth && !needsShape) return prev;
      return prev.map((it) =>
        it.id === id
          ? {
              ...it,
              ...(needsWidth ? { nativeWidthPx: widthPx } : {}),
              ...(needsShape ? { measuredUrl: url, measuredWidthPx: widthPx, measuredHeightPx: heightPx } : {}),
            }
          : it,
      );
    });
  }, [setItems]);

  const duplicateSelected = () => {
    const sourceIds = [
      ...(selectedId == null ? [] : [selectedId]),
      ...[...selectedIds].filter((id) => id !== selectedId),
    ];
    const sources = sourceIds
      .map((id) => items.find((it) => it.id === id))
      .filter((it): it is NonNullable<typeof it> => Boolean(it));
    if (sources.length === 0) return;
    if (isSheetFull(items as any)) {
      toast.error(
        `Sheet is full — the maximum length of ${MAX_SHEET_HEIGHT_IN.toLocaleString()}in has been reached. Remove artwork to add more.`,
      );
      return;
    }
    history.commit();
    let nextId = counter;
    const newGroupIds = new Map<string, string>();
    const copyGroupId = (groupId?: string) => {
      if (!groupId) return undefined;
      if (!newGroupIds.has(groupId)) newGroupIds.set(groupId, `g-${Date.now().toString(36)}-${newGroupIds.size}`);
      return newGroupIds.get(groupId);
    };
    const copies = sources.map((source) => ({
      ...source,
      id: ++nextId,
      groupId: copyGroupId(source.groupId),
      posX: source.posX + 0.5,
      posY: source.posY + 0.5,
      locked: false,
      pinned: false,
      gravityActive: true,
    }));
    setCounter(nextId);
    setItems((prev) => {
      const next = [...prev];
      // Each copy right after its source, so it stacks where you expect.
      for (const copy of copies) {
        const sourceIndex = next.findIndex((it) => it.id === sources[copies.indexOf(copy)].id);
        next.splice(sourceIndex === -1 ? next.length : sourceIndex + 1, 0, copy);
      }
      return next;
    });
    // The copies alone are selected. Setting only the primary left the original in
    // the multi-selection too, so both showed handles.
    setSelectedId(copies[0].id);
    setSelectedIds(new Set(copies.map((c) => c.id)));
  };

  /** Everything selected, the clicked piece first. */
  const selectionIds = [
    ...(selectedId == null ? [] : [selectedId]),
    ...[...selectedIds].filter((id) => id !== selectedId),
  ];
  const selectedPieces = selectionIds
    .map((id) => items.find((it) => it.id === id))
    .filter((it): it is NonNullable<typeof it> => Boolean(it));

  /**
   * What the toolbar's Group button would do: bundle the selection, split the
   * group it is, or nothing (a single loose piece has nothing to group with).
   *
   * This button was "Link", and merged two selected copies of one image into a
   * single piece with copies — a second meaning for a word the properties panel
   * already used for keeping proportions, and with one piece selected it did
   * nothing at all.
   */
  const groupAction: "group" | "ungroup" | null = (() => {
    if (selectedPieces.length === 0) return null;
    const groupIds = new Set(selectedPieces.map((it) => it.groupId ?? `loose-${it.id}`));
    if (groupIds.size === 1 && selectedPieces[0].groupId) return "ungroup";
    return selectedPieces.length >= 2 ? "group" : null;
  })();

  const groupSelection = () => {
    if (selectedPieces.length < 2) return;
    const groupId = `g-${Date.now().toString(36)}`;
    const ids = new Set(selectedPieces.map((it) => it.id));
    history.commit();
    setItems((prev) => prev.map((it) => (ids.has(it.id) ? { ...it, groupId } : it)));
    toast.success(`${ids.size} images grouped — they now move as one.`, { id: "group" });
  };

  const ungroupSelection = () => {
    const ids = new Set(selectedPieces.map((it) => it.id));
    if (ids.size === 0) return;
    history.commit();
    setItems((prev) => prev.map((it) => (ids.has(it.id) ? { ...it, groupId: undefined } : it)));
    toast.success("Ungrouped.", { id: "group" });
  };

  return (
    <div
      id="artboard-main-container"
      className="flex-1 relative bg-gray-50 overflow-hidden flex flex-col artboard-capture-area"
      style={{ userSelect: isResizing || isDraggingItem ? "none" : "auto" }}
    >
      <FailedUploadsPanel
        items={notUploaded.map((it) => ({ id: it.id, name: it.name, url: it.url }))}
        onShow={showItem}
        onRemove={removeItems}
      />
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
          dpiHighlightIds={dpiFlags.set}
          notUploadedIds={notUploadedIds}
          issueTarget={issueTarget}
          transparencyVerdicts={transparencyVerdicts}
          onCancelUpload={cancelUploads}
          onBrowseFiles={() => fileInputRef.current?.click()}
          items={items}
          selectedId={selectedId}
          selectedIds={selectedIds}
          showProperties={showProperties}
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
            const clicked = items.find((it) => it.id === id);
            const unit = clicked?.groupId
              ? items.filter((it) => it.groupId === clicked.groupId).map((it) => it.id)
              : [id];
            if (multi) {
              const next = new Set(selectedIds);
              if (selectedId != null) next.add(selectedId);
              const removing = unit.every((u) => next.has(u));
              for (const u of unit) {
                if (removing) next.delete(u);
                else next.add(u);
              }
              setSelectedIds(next);
              setSelectedId(removing ? ([...next][0] ?? null) : id);
            } else {
              setSelectedId(id);
              setSelectedIds(new Set(unit));
            }
            setShowProperties({});
          }}
          onToggleProperties={(id) =>
            setShowProperties((prev) => ({ ...prev, [id]: true }))
          }
          itemActions={{ ...itemActions, rotateSelected }}
          groupAction={groupAction}
          onGroup={groupAction === "ungroup" ? ungroupSelection : groupSelection}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelection}
          onCloseProperties={() => setShowProperties({})}
          onRemoveBg={itemActions.removeBg}
          onMeasured={recordMeasuredWidth}
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
        {/* Nothing to zoom on an empty board, and on a phone the card sat on
            top of the upload panel. */}
        {!(isTouch && items.length === 0) && (
        <ZoomControls
          zoom={zoom}
          onZoomIn={() => applyZoom(zoom + ZOOM.STEP * 2)}
          onZoomOut={() => applyZoom(zoom - ZOOM.STEP * 2)}
          onZoomFit={() => applyZoom(null)}
          isFit={zoomOverride === null}
        />
        )}
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
            const { prompt, request } = ai.preview!;
            ai.discardPreview();
            aiConversation.send(prompt, request);
          }}
        />
      )}
    </div>
  );
}
