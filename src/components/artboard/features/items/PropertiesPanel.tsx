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
    widthIn: number;
    heightIn: number;
    posX: number;
    posY: number;
  };
  addedToCart: boolean;
  initialPos: { x: number; y: number };
  onClose: () => void;
  onToggleAutoCrop: () => void;
  onSetCopies: (n: number) => void;
  onToggleLinked: () => void;
  onSetWidthIn: (n: number) => void;
  onSetHeightIn: (n: number) => void;
  onSetPosX: (n: number) => void;
  onSetPosY: (n: number) => void;
  onAddToCart: () => void;
}

const fmt = (n: number) => parseFloat(n.toFixed(2)).toString();

function DimInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
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
        onChange={(e) => {
          const raw = e.target.value;
          setLocal(raw);
          const n = parseFloat(raw);
          if (!isNaN(n) && n > 0) {
            onChange(parseFloat(n.toFixed(2)));
          }
        }}
        onBlur={() => {
          const n = parseFloat(local);
          if (!isNaN(n) && n > 0) {
            onChange(parseFloat(n.toFixed(2)));
          } else {
            setLocal(fmt(value));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full h-7 px-2 rounded-md text-[11px] font-semibold bg-[#F3F3F5]"
      />
    </div>
  );
}

function CopiesInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
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
      onChange={(e) => {
        const raw = e.target.value;
        setLocal(raw);
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= 1) onChange(n);
      }}
      onBlur={() => {
        const n = parseInt(local, 10);
        if (!isNaN(n) && n >= 1) {
          onChange(n);
          setLocal(String(n));
        } else {
          setLocal(String(value));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-full h-7 px-2 rounded-md text-[11px] bg-[#F3F3F5]"
    />
  );
}

const HEADER_HEIGHT = 40; // matches h-10 in Header.tsx
const TOP_SAFE_PX = HEADER_HEIGHT + 8;
const PANEL_WIDTH_PX = 320; // matches w-80
const EDGE_PADDING_PX = 8;

// Clamp panel position so it never overlaps the top toolbar or escapes the viewport.
function clampPanelPos(x: number, y: number, panelHeightPx: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = Math.max(EDGE_PADDING_PX, vw - PANEL_WIDTH_PX - EDGE_PADDING_PX);
  const maxY = Math.max(TOP_SAFE_PX, vh - panelHeightPx - EDGE_PADDING_PX);
  return {
    x: Math.min(Math.max(EDGE_PADDING_PX, x), maxX),
    y: Math.min(Math.max(TOP_SAFE_PX, y), maxY),
  };
}

export default function PropertiesPanel({
  item,
  addedToCart,
  initialPos,
  onClose,
  onToggleAutoCrop,
  onSetCopies,
  onToggleLinked,
  onSetWidthIn,
  onSetHeightIn,
  onSetPosX,
  onSetPosY,
  onAddToCart,
}: PropertiesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const measureHeight = () => panelRef.current?.offsetHeight || 420;

  const [pos, setPos] = useState(() =>
    clampPanelPos(initialPos.x, initialPos.y, 420)
  );

  // Sync position when the panel first opens; clamp fully into viewport
  useEffect(() => {
    setPos(clampPanelPos(initialPos.x, initialPos.y, measureHeight()));
  }, [initialPos]);

  // Re-clamp on viewport resize so the panel can never end up under the header / off-screen
  useEffect(() => {
    const onResize = () => {
      setPos((p) => clampPanelPos(p.x, p.y, measureHeight()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Close when clicking outside the panel
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
    if ((e.target as HTMLElement).closest("button")) return;
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
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      className="w-80 bg-white border border-gray-300 shadow-2xl rounded-xl select-none"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-gray-300 cursor-grab active:cursor-grabbing"
        onMouseDown={onHeaderMouseDown}
      >
        <span className="font-semibold text-[14px]">Properties</span>
        <button className="p-1 text-gray-600 hover:text-black" onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <MdClose className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2.5 flex items-center justify-between">
        <div className="text-[12px]">
          <div className="font-medium text-gray-900 truncate max-w-[240px]" title={item.name || `Item #${item.id}`}>{item.name || `Item #${item.id}`}</div>
          <div className="text-gray-500">
            {item.copies > 1 ? `${item.copies} linked copies` : "1 copy"}
          </div>
        </div>
      </div>

      <div
        className="px-3 py-2.5 border-t border-gray-300 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={onToggleAutoCrop}
      >
        <div>
          <div className="font-medium text-gray-900 text-[12px]">Auto Crop</div>
          <div className="text-gray-500 text-[10px]">Remove empty space</div>
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

      <div className="px-3 py-2.5 border-t border-gray-300">
        <div className="text-[12px] font-medium text-gray-900 mb-2">Number of Copies</div>
        <CopiesInput value={item.copies} onChange={onSetCopies} />
      </div>

      <div className="px-3 py-2.5 border-t border-gray-300">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-medium text-gray-900">Dimensions</div>
          <button
            className={`text-[12px] font-medium transition-colors hover:underline ${
              item.linked ? "text-blue-600" : "text-gray-400"
            }`}
            onClick={onToggleLinked}
            title={item.linked ? "Click to Unlink" : "Click to Link"}
          >
            {item.linked ? "Unlink" : "Link"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DimInput label="Width (in)" value={item.widthIn} onChange={onSetWidthIn} />
          <DimInput label="Height (in)" value={item.heightIn} onChange={onSetHeightIn} />
        </div>
      </div>

      <div className="px-3 py-2.5 border-t border-gray-300">
        <div className="text-[12px] font-medium text-gray-900 mb-2">Position</div>
        <div className="grid grid-cols-2 gap-2">
          <DimInput label="X Wide" value={item.posX} onChange={onSetPosX} />
          <DimInput label="Y Long" value={item.posY} onChange={onSetPosY} />
        </div>
      </div>
    </div>
  );
}
