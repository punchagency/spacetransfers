import { useEffect, useRef, useState } from "react";
import { MdClose } from "react-icons/md";

interface PropertiesPanelProps {
  item: {
    id: number;
    name?: string;
    price: number;
    autoCrop: boolean;
    copies: number;
    linked: boolean;
    locked?: boolean;
    widthIn: number;
    heightIn: number;
    posX: number;
    posY: number;
  };
  initialPos: { x: number; y: number };
  onClose: () => void;
  onToggleAutoCrop: () => void;
  onSetCopies: (n: number) => void;
  onToggleLinked: () => void;
  onSetWidthIn: (n: number) => void;
  onSetHeightIn: (n: number) => void;
  onSetPosX: (n: number) => void;
  onSetPosY: (n: number) => void;
}

const fmt = (n: number) => parseFloat(n.toFixed(2)).toString();

function DimInput({
  label,
  value,
  onChange,
  /**
   * Smallest value the field accepts. A size must be positive, but a position
   * may be 0 — typing it there used to be ignored, so "put it at the top" did
   * nothing. It is applied and then clamped to the margin, like any other move.
   */
  min = 0.01,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(fmt(value));

  useEffect(() => {
    const localNum = parseFloat(local);
    if (isNaN(localNum) || Math.abs(localNum - value) > 0.005) {
      setLocal(fmt(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div>
      <label className="text-[11px] font-semibold text-gray-600">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={local}
        disabled={disabled}
        // Applied on Enter or leaving the field, not per keystroke: typing "12"
        // used to make the piece 1in first, and auto-nest re-packed around it.
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local);
          if (!isNaN(n) && n >= min) onChange(parseFloat(n.toFixed(2)));
          // Show what was actually applied — a refused or clamped value included.
          setLocal(fmt(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full h-7 px-2 rounded-md text-[11px] font-semibold bg-[#F3F3F5] disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}

function CopiesInput({ value, onChange, disabled = false }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => {
    const localNum = parseInt(local, 10);
    if (isNaN(localNum) || localNum !== value) {
      setLocal(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={local}
      disabled={disabled}
      // Applied on Enter or leaving the field, like the dimensions.
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = parseInt(local, 10);
        if (!isNaN(n) && n >= 1) onChange(n);
        setLocal(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-full h-7 px-2 rounded-md text-[11px] bg-[#F3F3F5] disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

const HEADER_HEIGHT = 40;
const TOP_SAFE_PX = HEADER_HEIGHT + 8;
const PANEL_WIDTH_PX = 288;
const EDGE_PADDING_PX = 8;
const TOOLBAR_GAP_PX = 12;

function clampPanelPos(x: number, y: number, panelHeightPx: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = Math.max(EDGE_PADDING_PX, vw - PANEL_WIDTH_PX - EDGE_PADDING_PX);
  const maxY = Math.max(TOP_SAFE_PX, vh - panelHeightPx - EDGE_PADDING_PX);
  let clampedX = Math.min(Math.max(EDGE_PADDING_PX, x), maxX);
  let clampedY = Math.min(Math.max(TOP_SAFE_PX, y), maxY);

  const toolbar = document.querySelector("[data-action-toolbar]") as HTMLElement | null;
  if (toolbar) {
    const tb = toolbar.getBoundingClientRect();
    if (tb.width > 0 && tb.height > 0) {
      const tbLeft = tb.left - TOOLBAR_GAP_PX;
      const tbRight = tb.right + TOOLBAR_GAP_PX;
      const tbTop = tb.top - TOOLBAR_GAP_PX;
      const tbBottom = tb.bottom + TOOLBAR_GAP_PX;

      const overlapsX = clampedX < tbRight && clampedX + PANEL_WIDTH_PX > tbLeft;
      const overlapsY = clampedY < tbBottom && clampedY + panelHeightPx > tbTop;

      if (overlapsX && overlapsY) {
        const leftSlot = tbLeft - PANEL_WIDTH_PX;
        const rightSlot = tbRight;
        const fitsLeft = leftSlot >= EDGE_PADDING_PX;
        const fitsRight = rightSlot + PANEL_WIDTH_PX <= vw - EDGE_PADDING_PX;

        if (fitsLeft || fitsRight) {
          const distLeft = fitsLeft ? Math.abs(clampedX - leftSlot) : Infinity;
          const distRight = fitsRight ? Math.abs(clampedX - rightSlot) : Infinity;
          clampedX = distLeft <= distRight ? leftSlot : rightSlot;
        } else {
          clampedY = Math.min(tbBottom, maxY);
        }
      }
    }
  }

  return { x: clampedX, y: clampedY };
}

export default function PropertiesPanel({
  item,
  initialPos,
  onClose,
  onToggleAutoCrop,
  onSetCopies,
  onToggleLinked,
  onSetWidthIn,
  onSetHeightIn,
  onSetPosX,
  onSetPosY,
}: PropertiesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const measureHeight = () => panelRef.current?.offsetHeight || 420;

  const [pos, setPos] = useState(() =>
    clampPanelPos(initialPos.x, initialPos.y, 420)
  );

  const prevAnchorRef = useRef(initialPos);
  const firstSyncRef = useRef(true);
  useEffect(() => {
    if (firstSyncRef.current) {
      setPos(clampPanelPos(initialPos.x, initialPos.y, measureHeight()));
      prevAnchorRef.current = initialPos;
      firstSyncRef.current = false;
      return;
    }
    const dx = initialPos.x - prevAnchorRef.current.x;
    const dy = initialPos.y - prevAnchorRef.current.y;
    prevAnchorRef.current = initialPos;
    if (dx === 0 && dy === 0) return;
    setPos((p) => clampPanelPos(p.x + dx, p.y + dy, measureHeight()));
  }, [initialPos.x, initialPos.y]);

  useEffect(() => {
    const onResize = () => {
      setPos((p) => clampPanelPos(p.x, p.y, measureHeight()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    e.preventDefault();
    draggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: pos.x,
      panelY: pos.y,
    };

    const onMove = (me: MouseEvent) => {
      if (!draggingRef.current) return;
      const rawX = dragStartRef.current.panelX + (me.clientX - dragStartRef.current.mouseX);
      const rawY = dragStartRef.current.panelY + (me.clientY - dragStartRef.current.mouseY);
      setPos(clampPanelPos(rawX, rawY, measureHeight()));
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
      }}
      className="w-72 bg-white border border-gray-300 rounded-md shadow-2xl select-none overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-200 cursor-grab active:cursor-grabbing"
        onMouseDown={onHeaderMouseDown}
      >
        <div className="flex-1 min-w-0">
          <div
            className="text-[12px] font-semibold text-gray-900 truncate"
            title={item.name || `Item #${item.id}`}
          >
            {item.name || `Item #${item.id}`}
          </div>
        </div>
        <button
          className="p-1 rounded-full text-gray-500 hover:text-black hover:bg-gray-100 transition-colors shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close"
        >
          <MdClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {item.locked && (
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-[11px] text-gray-600">
          🔒 This image is locked. Unlock it from the toolbar to make changes.
        </div>
      )}
      {/* Auto Crop */}
      <div
        className={`px-3 py-2.5 border-b border-gray-200 flex items-center justify-between transition-colors ${
          item.locked ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50 cursor-pointer"
        }`}
        onClick={item.locked ? undefined : onToggleAutoCrop}
      >
        <div>
          <div className="font-medium text-gray-900 text-[12px]">Auto Crop</div>
          <div className="text-gray-500 text-[10px]">Trim empty space around the artwork</div>
        </div>
        <button
          className={`w-9 h-5 rounded-full flex items-center transition-colors pointer-events-none ${
            item.autoCrop ? "bg-blue-600" : "bg-gray-300"
          }`}
          tabIndex={-1}
        >
          <span
            className={`w-4 h-4 bg-white rounded-full shadow transform transition ${
              item.autoCrop ? "translate-x-4" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Number of Copies */}
      <div className="px-3 py-2.5 border-b border-gray-200">
        <div className="text-[12px] font-medium text-gray-900 mb-2">Number of Copies</div>
        <CopiesInput value={item.copies} onChange={onSetCopies} disabled={item.locked} />
      </div>

      {/* Dimensions */}
      <div className="px-3 py-2.5 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-medium text-gray-900">Dimensions</div>
          <button
            className={`text-[12px] font-medium transition-colors hover:underline ${
              item.linked ? "text-blue-600" : "text-gray-400"
            }`}
            onClick={item.locked ? undefined : onToggleLinked}
            disabled={item.locked}
            title={item.linked ? "Width and height change together — click to size them separately" : "Click to keep width and height in proportion"}
          >
            {item.linked ? "Unlink" : "Link"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DimInput label="Width (in)" value={item.widthIn} onChange={onSetWidthIn} disabled={item.locked} />
          <DimInput label="Height (in)" value={item.heightIn} onChange={onSetHeightIn} disabled={item.locked} />
        </div>
      </div>

      {/* Position */}
      <div className="px-3 py-2.5">
        <div className="text-[12px] font-medium text-gray-900 mb-2">Position</div>
        <div className="grid grid-cols-2 gap-2">
          <DimInput label="X Wide" value={item.posX} onChange={onSetPosX} min={0} disabled={item.locked} />
          <DimInput label="Y Long" value={item.posY} onChange={onSetPosY} min={0} disabled={item.locked} />
        </div>
      </div>
    </div>
  );
}
