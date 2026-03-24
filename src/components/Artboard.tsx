import { useEffect, useState } from "react";
import {
  useItemActions,
  useMouseInteractions,
  useDropHandler,
  useCanvasWidth,
  useArtboardEffects,
} from "./artboard/lib/hooks";
import { snapToGridPoint } from "./artboard/lib/utils";
import { DpiWarning, CanvasContainer } from "./artboard/features/canvas";
import type { ArtboardProps } from "./artboard/types";

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
  onDataChange,
  initialData,
  onAddToCart,
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

  const canvasWidth = useCanvasWidth();
  const { isDragging, lowDpiCount, onDragOver, onDragLeave, onDropEvent } =
    useDropHandler(
      items,
      setItems,
      counter,
      setCounter,
      setSelectedId,
      canvasWidth,
      zoom,
      autoNestStickers,
      spacing,
      marginSize,
    );
  const itemActions = useItemActions(
    items,
    setItems,
    selectedId,
    snapToGrid,
    snapToGridPoint,
    onActionPerformed,
  );
  const { handleResizeStart, handleDragStart, isDraggingItem } =
    useMouseInteractions(
      items,
      setItems,
      selectedId,
      zoom,
      snapToGrid,
      snapToGridPoint,
      autoNestStickers,
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
  }, [initialData]);

  const duplicateSelected = () => {
    if (selectedId == null) return;
    const target = items.find((it) => it.id === selectedId);
    if (!target) return;
    const newId = counter + 1;
    setCounter(newId);
    const copy = {
      ...target,
      id: newId,
      posX: target.posX + 0.5,
      posY: target.posY + 0.5,
    };
    setItems((prev) => [...prev, copy]);
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
      <DpiWarning count={lowDpiCount} />
      <div className="flex-1 flex overflow-hidden">
        <CanvasContainer
          zoom={zoom}
          showRulers={showRulers}
          showMargins={showMargins}
          marginSize={marginSize}
          canvasWidth={canvasWidth}
          isDragging={isDragging}
          items={items}
          selectedId={selectedId}
          selectedIds={selectedIds}
          showProperties={showProperties}
          addedToCart={addedToCart}
          emptyOffsetY={350}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              setZoom((z) =>
                Math.min(3, Math.max(0.5, +(z + delta).toFixed(2))),
              );
            }
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDropEvent}
          onZoomIn={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
          onZoomOut={() => setZoom((z) => Math.max(1, +(z - 0.1).toFixed(2)))}
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
          onDragStart={handleDragStart}
          onResizeStart={handleResizeStart}
          isDraggingItem={isDraggingItem}
        />
      </div>
    </div>
  );
}
