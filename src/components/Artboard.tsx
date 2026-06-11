import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  useItemActions,
  useMouseInteractions,
  useDropHandler,
  useCanvasWidth,
  useArtboardEffects,
  useHistory,
} from "./artboard/lib/hooks";
import { snapToGridPoint } from "./artboard/lib/utils";
import { ArtboardWarning, CanvasContainer } from "./artboard/features/canvas";
import type { ArtboardProps } from "./artboard/types";
import { CANVAS } from "../config/artboard.config";

export default function Artboard({
  onHeaderInfoChange,
  onActionPerformed,
  showRulers = true,
  showGrid = true,
  snapToGrid = false,
  showMargins = false,
  marginSize = 0.25,
  autoNestStickers = false,
  spacing = 0.5,
  onRequestAutoNest,
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

  const canvasWidth = useCanvasWidth();

  // Auto-fit the 23.5" sheet width into the visible area at browser zoom 100%.
  // No user controls; this is just a responsive scale used for layout + interaction math.
  useEffect(() => {
    const el = document.querySelector("#artboard-main-container") as HTMLElement | null;
    if (!el) return;

    const neededPx = CANVAS.SHEET_WIDTH_IN * CANVAS.PIXELS_PER_INCH;
    if (!neededPx) return;

    const update = () => {
      const availablePx = Math.max(0, el.clientWidth - CANVAS.RULER_OFFSET_PX);
      const fit = availablePx / neededPx;
      setZoom(Math.min(1, Math.max(0.1, fit || 1)));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
    lowDpiCount,
    fadeCount,
    isUploading,
    uploadProgress,
    uploadFileName,
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
    );
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
  const { handleResizeStart, handleDragStart, isDraggingItem, isResizing } =
    useMouseInteractions(
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

  const duplicateSelected = () => {
    if (selectedId == null) return;
    if (items.length >= CANVAS.MAX_ITEMS) {
      toast.error(`Item limit of ${CANVAS.MAX_ITEMS} reached. Remove items to add more.`);
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
    setSelectedId(newId);
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
    >
      <ArtboardWarning
        lowDpiCount={lowDpiCount > 0 ? items.filter((it) => typeof it.dpi === "number" && it.dpi < 300).length : 0}
        fadeCount={fadeCount > 0 ? items.filter((it) => it.hasFade).length : 0}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
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
          showMargins={showMargins}
          marginSize={marginSize}
          spacing={spacing}
          autoNestStickers={autoNestStickers}
          canvasWidth={canvasWidth}
          isDragging={isDragging}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          uploadFileName={uploadFileName}
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
        />
      </div>
    </div>
  );
}
