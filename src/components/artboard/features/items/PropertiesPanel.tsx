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
  onClose: () => void;
  onToggleAutoCrop: () => void;
  onSetCopies: (n: number) => void;
  onToggleLinked: () => void;
  onSetWidthIn: (n: number) => void;
  onSetHeightIn: (n: number) => void;
  onSetPosX: (n: number) => void;
  onSetPosY: (n: number) => void;
  onAddToCart: () => void;
  position?: "left" | "right" | "center";
}

export default function PropertiesPanel({
  item,
  addedToCart,
  onClose,
  onToggleAutoCrop,
  onSetCopies,
  onToggleLinked,
  onSetWidthIn,
  onSetHeightIn,
  onSetPosX,
  onSetPosY,
  onAddToCart,
  position = "right",
}: PropertiesPanelProps) {
  return (
    <div
      className={`absolute ${
        position === "center"
          ? "top-0 left-1/2 -translate-x-1/2"
          : position === "right"
            ? "top-0 left-full ml-3"
            : "top-0 right-full mr-3"
      } z-50 w-60 bg-white border border-gray-300 shadow-2xl rounded-xl`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-300">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[12px]">Properties</span>
        </div>
        <button
          className="p-1 text-gray-600 hover:text-black"
          onClick={onClose}
        >
          <MdClose className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="text-[10px]">
          <div className="font-medium text-gray-900">
            {item.name || `Item #${item.id}`}
          </div>
          <div className="text-gray-500">
            {item.copies > 1 ? `${item.copies} linked copies` : "1 copy"}
          </div>
        </div>
        <div className="text-[10px] font-semibold text-gray-900">
          {item.copies > 1
            ? `$${(item.price * item.copies).toFixed(2)} total`
            : `$${item.price.toFixed(2)}/each`}
        </div>
      </div>
      <div className="px-3 py-2 border-t border-gray-300 flex items-center justify-between">
        <div>
          <div className="font-medium text-gray-900 text-[10px]">Auto Crop</div>
          <div className="text-gray-500 text-[8px]">Remove empty space</div>
        </div>
        <button
          className={`w-9 h-5 rounded-full flex items-center transition-colors ${
            item.autoCrop ? "bg-blue-600" : "bg-gray-300"
          }`}
          onClick={onToggleAutoCrop}
        >
          <span
            className={`w-4 h-4 bg-white rounded-full shadow transform transition ${
              item.autoCrop ? "translate-x-4" : "translate-x-1"
            }`}
          ></span>
        </button>
      </div>
      <div className="px-3 py-2 border-t border-gray-300">
        <div className="text-[10px] font-medium text-gray-900 mb-2">
          Number of Copies
        </div>
        <input
          type="number"
          min={1}
          max={250}
          value={item.copies}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "") {
              return; // Allow empty input while typing
            }
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue >= 1) {
              const clamped = Math.min(numValue, 250);
              onSetCopies(clamped);
            }
          }}
          onBlur={(e) => {
            const value = e.target.value;
            const numValue = parseInt(value, 10);
            if (value === "" || isNaN(numValue) || numValue < 1) {
              onSetCopies(1);
            } else {
              const clamped = Math.min(numValue, 250);
              if (clamped !== numValue) {
                onSetCopies(clamped);
              }
            }
          }}
          className="w-full h-6 px-2 rounded-md text-[8px] bg-[#F3F3F5]"
        />
      </div>
      <div className="px-3 py-2 border-t border-gray-300">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-medium text-gray-900">
            Dimensions
          </div>
          <button
            className={`text-[10px] font-medium transition-colors hover:underline ${
              item.linked ? "text-blue-600" : "text-gray-400"
            }`}
            onClick={onToggleLinked}
            title={item.linked ? "Click to Unlink" : "Click to Link"}
          >
            {item.linked ? "Unlink" : "Link"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[8px] text-gray-500">Width (in)</label>
            <input
              type="number"
              step="0.01"
              value={Number(item.widthIn.toFixed(2))}
              onChange={(e) => onSetWidthIn(parseFloat(e.target.value || "0"))}
              className="w-full h-6 px-2 rounded-md text-[8px] bg-[#F3F3F5]"
            />
          </div>
          <div>
            <label className="text-[8px] text-gray-500">Height (in)</label>
            <input
              type="number"
              step="0.01"
              value={Number(item.heightIn.toFixed(2))}
              onChange={(e) => onSetHeightIn(parseFloat(e.target.value || "0"))}
              className="w-full h-6 px-2 rounded-md text-[8px] bg-[#F3F3F5]"
            />
          </div>
        </div>
      </div>
      <div className="px-3 py-2 border-t border-gray-300">
        <div className="text-[10px] font-medium text-gray-900 mb-2">
          Position
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[8px] text-gray-500">X Wide</label>
            <input
              type="number"
              step="0.01"
              value={Number(item.posX.toFixed(2))}
              onChange={(e) => onSetPosX(parseFloat(e.target.value || "0"))}
              className="w-full h-6 px-2 rounded-md text-[8px] bg-[#F3F3F5]"
            />
          </div>
          <div>
            <label className="text-[8px] text-gray-500">Y Long</label>
            <input
              type="number"
              step="0.01"
              value={Number(item.posY.toFixed(2))}
              onChange={(e) => onSetPosY(parseFloat(e.target.value || "0"))}
              className="w-full h-6 px-2 rounded-md text-[8px] bg-[#F3F3F5]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
