import { useEffect, useState } from "react";
import { MdClose } from "react-icons/md";
import { LiaSave } from "react-icons/lia";
import { FiFileText } from "react-icons/fi";

interface SaveGangSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (title: string, thumbnail: string, data: any) => void;
  artboardData?: any;
  initialTitle?: string | null;
}

const SaveGangSheetModal: React.FC<SaveGangSheetModalProps> = ({
  isOpen,
  onClose,
  onSave,
  artboardData,
  initialTitle,
}) => {
  const [designName, setDesignName] = useState("Untitled Design");

  useEffect(() => {
    if (!isOpen) return;
    setDesignName(initialTitle?.trim() || "Untitled Design");
  }, [isOpen, initialTitle]);

  const handleSave = async () => {
    const artboard = document.querySelector(
      ".flex-1.relative.flex.items-center",
    ) as HTMLElement;
    if (artboard) {
      // Cap at 2× so thumbnails stay manageable on 3× mobile screens while still
      // being Retina-sharp on all desktop displays.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = artboard.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(rect.width  * dpr);
      canvas.height = Math.round(rect.height * dpr);

      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Scale so draw calls use CSS pixel coordinates; the canvas is already
        // sized in physical (dpr-scaled) pixels.
        ctx.scale(dpr, dpr);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        // White background base
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);

        const gridBg = artboard.querySelector(".absolute.inset-0.z-0") as HTMLElement;
        if (gridBg) {
          const pattern = ctx.createPattern(
            await createPatternCanvas(window.getComputedStyle(gridBg)),
            "repeat",
          );
          if (pattern) {
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, rect.width, rect.height);
          }
        }

        const images = artboard.querySelectorAll('img[alt^="copy-"], img[alt="dropped"]');
        for (const img of Array.from(images)) {
          const htmlImg = img as HTMLImageElement;
          const imgRect = htmlImg.getBoundingClientRect();
          const x = imgRect.left - rect.left;
          const y = imgRect.top  - rect.top;
          ctx.drawImage(htmlImg, x, y, imgRect.width, imgRect.height);
        }

        // Lossless PNG thumbnail — no JPEG compression artifacts
        const thumbnail = canvas.toDataURL("image/png");
        onSave(designName, thumbnail, artboardData);
        setDesignName("Untitled Design");
      }
    }
  };

  const createPatternCanvas = async (
    bgStyle: CSSStyleDeclaration,
  ): Promise<HTMLCanvasElement> => {
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = 40;
    patternCanvas.height = 40;
    const pCtx = patternCanvas.getContext("2d");
    if (pCtx) {
      pCtx.fillStyle = "#E9F2F1";
      pCtx.fillRect(0, 0, 10, 10);
      pCtx.fillRect(10, 10, 10, 10);
      pCtx.fillRect(20, 0, 10, 10);
      pCtx.fillRect(30, 10, 10, 10);
      pCtx.fillRect(0, 20, 10, 10);
      pCtx.fillRect(10, 30, 10, 10);
      pCtx.fillRect(20, 20, 10, 10);
      pCtx.fillRect(30, 30, 10, 10);
    }
    return patternCanvas;
  };

  if (!isOpen) return null;
 
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 flex items-center justify-center bg-black/20 backdrop-blur-xs z-50"
    >

      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-[18px] shadow-lg w-full max-w-md mx-4"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center">
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#DCFCE7] mr-2">
              <LiaSave className="h-5 w-5 text-[#00A63E]" />
            </div>
            <div>
              <h2 className="text-[16px] font-medium text-gray-900">
                Save GangSheet
              </h2>
              <p className="text-[12px] text-gray-500">
                Give your gang sheet a name
              </p>
            </div>
          </div>
          <MdClose
            className="h-6 w-6 text-black hover:text-gray-500 cursor-pointer"
            onClick={onClose}
          />
        </div>
        {/* Design Name section */}
        <div className="px-4 py-4">
          <label className="block text-[14px] font-medium text-gray-700 mb-1">
            Design Name
          </label>
          <div className="flex items-center border border-gray-300 rounded-md px-3 py-2 bg-[#F3F3F5]">
            <FiFileText className="h-5 w-5 text-gray-400 mr-2" />
            <input
              type="text"
              value={designName}
              onChange={(e) => setDesignName(e.target.value)}
              className="flex-1 bg-transparent text-gray-900 text-[14px] outline-none"
              placeholder="Untitled Design"
            />
          </div>
          <p className="mt-1 text-[12px] text-gray-500">
            You can change this name later
          </p>
        </div>
        {/* Bottom bar */}
        <div className="flex bg-[#F8FAFC] text-[14px] items-center justify-end px-4 py-3 border-t border-[#F1F5F9] space-x-3 rounded-b-[18px]">
          <button
            className="text-gray-700 font-medium hover:text-gray-900"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center bg-[#00A63E] text-white px-2.5 py-2 rounded-lg hover:bg-[#00A63E]"
            onClick={handleSave}
          >
            <LiaSave className="h-5 w-5 mr-2" />
            Save Design
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveGangSheetModal;
