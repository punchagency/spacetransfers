import { MdRotateRight, MdLock, MdLockOpen, MdContentCopy, MdAutoFixHigh, MdHighQuality, MdCheckCircle } from "react-icons/md";
import { LuFlipHorizontal } from "react-icons/lu";
import { RiDeleteBin5Line } from "react-icons/ri";
import { IoIosLink } from "react-icons/io";
import { HiOutlineSparkles } from "react-icons/hi2";
import { useIsMobile } from "../../../../lib/useIsMobile";

interface ItemToolbarProps {
  locked: boolean;
  onLink: () => void;
  onRotate: () => void;
  onToggleLock: () => void;
  onFlip: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onIncreaseDpi: () => void;
  currentDpi?: number;
  isDpiUnknown?: boolean;
  isDpiEnhancing?: boolean;
  dpiEnhanced?: boolean;
  onRemoveBg: () => void;
  bgStatus: 'detecting' | 'has-bg' | 'no-bg';
  isRemovingBg: boolean;
  bgProgress?: { phase: string; pct: number } | null;
  bgJustRemoved?: boolean;
  /** Opens the anchored AI panel. Omitted (undefined) hides the AI action. */
  onOpenAi?: () => void;
  /** The AI panel is currently open for this item — keeps the button highlighted. */
  aiActive?: boolean;
}

const Btn = ({ onClick, title, className = "", children }: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <button
    title={title}
    onClick={onClick}
    className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 active:scale-95 transition-all duration-100 select-none cursor-pointer ${className}`}
  >
    {children}
  </button>
);

const Sep = () => <span className="w-px h-6 bg-gray-200 flex-shrink-0 mx-0.5" />;

export default function ItemToolbar({ locked, onLink, onRotate, onToggleLock, onFlip, onDuplicate, onDelete, onIncreaseDpi, currentDpi, isDpiUnknown, isDpiEnhancing, dpiEnhanced, onRemoveBg, bgStatus, isRemovingBg, bgProgress, bgJustRemoved, onOpenAi, aiActive }: ItemToolbarProps) {
  const isMobile = useIsMobile();
  const bgDisabled = bgStatus === 'no-bg' || bgStatus === 'detecting' || isRemovingBg || bgJustRemoved;
  const dpiMeetsMinimum = typeof currentDpi === "number" && currentDpi >= 300;
  const isLowDpi = (typeof currentDpi === "number" && currentDpi < 300) || !!isDpiUnknown;
  // dpiMeetsMinimum alone gates re-enabling — it's derived fresh from the
  // item's CURRENT print size every render, so it correctly flips back to
  // false (re-enabling the button) if the user scales the item larger again
  // after a previous enhancement. dpiEnhanced is only a "just did this"
  // display flag (see the reset effect in ArtboardItem) and must never be
  // the thing keeping the button disabled once DPI has actually dropped again.
  const dpiButtonDisabled = dpiMeetsMinimum || isDpiEnhancing;

  return (
    <div className="pointer-events-auto w-full flex justify-center py-2">
    <div className="flex flex-col items-center gap-1">
      <div data-action-toolbar className="flex items-center px-1 py-1 bg-white border border-gray-200 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] max-md:max-w-[calc(100vw-1rem)] max-md:overflow-x-auto">
        <div className="flex items-center gap-0.5">

          {/* AI — the primary editing entry point, and deliberately the one
              standout in an otherwise monochrome toolbar: a living gradient pill
              with a breathing halo, a hover shine-sweep, and a lift. Sized to
              the same footprint as its siblings so it still sits natively in the
              row. See `.ai-tool-btn` in index.css for the idle animation. */}
          {onOpenAi && (
            <>
              <button
                data-ai-toggle
                onClick={(e) => { e.stopPropagation(); onOpenAi(); }}
                title="Edit with AI"
                aria-pressed={aiActive}
                className={`ai-tool-btn group/ai relative flex flex-col items-center justify-center gap-0.5 px-3 py-1 mr-0.5 rounded-[10px] text-[10px] font-bold text-white overflow-hidden select-none cursor-pointer transition-transform duration-200 ease-out hover:-translate-y-[1px] hover:scale-[1.06] active:scale-95 ${
                  aiActive ? "ring-2 ring-white/80 ring-offset-1 ring-offset-slate-900" : ""
                }`}
              >
                {/* Diagonal shine that sweeps across on hover. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-[160%] skew-x-[20deg] bg-gradient-to-r from-transparent via-white/55 to-transparent transition-transform duration-700 ease-out group-hover/ai:translate-x-[160%]"
                />
                <HiOutlineSparkles className="relative w-5 h-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-300 group-hover/ai:rotate-[-10deg] group-hover/ai:scale-110" />
                <span className="relative tracking-wide drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]">AI</span>
              </button>
              <Sep />
            </>
          )}

          <Btn onClick={(e) => { e.stopPropagation(); onLink(); }} title="Link">
            <IoIosLink className="w-5 h-5" />
            <span>Link</span>
          </Btn>

          <Sep />

          <Btn onClick={(e) => { e.stopPropagation(); onRotate(); }} title="Rotate">
            <MdRotateRight className="w-5 h-5" />
            <span>Rotate</span>
          </Btn>

          <Btn onClick={(e) => { e.stopPropagation(); onFlip(); }} title="Flip">
            <LuFlipHorizontal className="w-5 h-5" />
            <span>Flip</span>
          </Btn>

          <Btn onClick={(e) => { e.stopPropagation(); onToggleLock(); }} title={locked ? "Unlock" : "Lock"}>
            {locked ? <MdLock className="w-5 h-5" /> : <MdLockOpen className="w-5 h-5" />}
            <span>{locked ? "Unlock" : "Lock"}</span>
          </Btn>

          <Btn onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicate">
            <MdContentCopy className="w-5 h-5" />
            <span>Duplicate</span>
          </Btn>

          {/* DPI enhance + AI background removal are hidden on phones — both
              load/run heavy in-browser models (a multi-MB WASM AI) that can't
              be operated smoothly on a small touch device. */}
          {!isMobile && (
          <>
          <Sep />

          {/* DPI Enhancer */}
          <div className="relative group/dpi">
            <button
              disabled={dpiButtonDisabled}
              onClick={(e) => { e.stopPropagation(); if (!dpiButtonDisabled) onIncreaseDpi(); }}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-150 select-none ${
                isDpiEnhancing
                  ? "bg-amber-50 text-amber-400 cursor-wait"
                  : dpiEnhanced
                  ? "text-green-500 cursor-not-allowed"
                  : dpiMeetsMinimum
                  ? "text-gray-300 cursor-not-allowed"
                  : isLowDpi
                  ? "text-[#EDAE00] hover:text-[#C68A00] hover:bg-[#FFFBEB] active:scale-95 cursor-pointer"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100 active:scale-95 cursor-pointer"
              }`}
            >
              {isDpiEnhancing ? (
                <>
                  <span className="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                  <span className="text-amber-500">DPI…</span>
                </>
              ) : dpiEnhanced ? (
                <>
                  <MdCheckCircle className="w-5 h-5 text-green-500" />
                  <span>300 DPI</span>
                </>
              ) : (
                <>
                  <MdHighQuality className="w-5 h-5" />
                  <span>DPI+</span>
                </>
              )}
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover/dpi:flex flex-col gap-1 w-60 rounded-xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.12)] px-3 py-2.5 pointer-events-none z-50">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-gray-900">
                  {isDpiEnhancing ? "Enhancing…" : dpiEnhanced ? "Enhanced" : "Enhance DPI"}
                </span>
                {!dpiEnhanced && isDpiUnknown ? (
                  <span className="text-[11px] font-semibold text-[#EDAE00]">DPI Unknown</span>
                ) : typeof currentDpi === "number" && (
                  <span className={`text-[11px] font-semibold ${dpiEnhanced ? "text-green-500" : isLowDpi ? "text-[#EDAE00]" : "text-gray-500"}`}>
                    {dpiEnhanced ? "300" : currentDpi} DPI
                  </span>
                )}
              </div>
              {isDpiEnhancing ? (
                <span className="text-[11px] leading-snug text-amber-600">
                  Resizing image to 300 DPI — hold tight…
                </span>
              ) : dpiEnhanced ? (
                <span className="text-[11px] leading-snug text-green-600">
                  Image successfully enhanced to <span className="font-semibold">300 DPI</span>. No further enhancement needed.
                </span>
              ) : dpiMeetsMinimum ? (
                <span className="text-[11px] leading-snug text-gray-500">
                  DPI check is unavailable because this image already meets the minimum print-quality requirement of 300 DPI.
                </span>
              ) : isDpiUnknown ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  This image's resolution couldn't be determined, so print quality can't be confirmed. <span className="font-semibold text-[#C68A00]">Enhance to be safe</span> — it's scaled up to a clean 300 DPI.
                </span>
              ) : isLowDpi ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  Below print-ready. <span className="font-semibold text-[#C68A00]">One click enhances to 300 DPI</span> — image scales to keep print quality crisp.
                </span>
              ) : (
                <span className="text-[11px] leading-snug text-gray-600">
                  Adds <span className="font-semibold">+50 DPI</span> per click (up to 600) and scales the image down proportionally.
                </span>
              )}
            </div>
          </div>

          <Sep />

          {/* BG Remover */}
          <div className="relative group/bg">
            <button
              disabled={bgDisabled}
              onClick={(e) => { e.stopPropagation(); if (!bgDisabled) onRemoveBg(); }}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-150 select-none ${
                bgJustRemoved
                  ? 'text-green-500 cursor-not-allowed'
                  : bgStatus === 'no-bg'
                  ? 'text-gray-300 cursor-not-allowed'
                  : isRemovingBg
                  ? 'bg-gray-100 text-gray-400 cursor-wait'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-gray-100 active:scale-95 cursor-pointer'
              }`}
            >
              {isRemovingBg ? (
                <>
                  <span className="w-5 h-5 border-2 border-gray-300 border-t-slate-900 rounded-full animate-spin" />
                  <span className="text-slate-600">Removing…</span>
                </>
              ) : bgJustRemoved ? (
                <>
                  <MdCheckCircle className="w-5 h-5 text-green-500" />
                  <span>BG Done</span>
                </>
              ) : (
                <>
                  <MdAutoFixHigh className={`w-5 h-5 ${bgStatus === 'no-bg' ? 'text-gray-300' : 'text-slate-700'}`} />
                  <span>{bgStatus === 'no-bg' ? 'BG Removed' : 'BG Remover'}</span>
                </>
              )}
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover/bg:flex flex-col gap-1 w-60 rounded-xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.12)] px-3 py-2.5 pointer-events-none z-50">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-gray-900">Background Remover</span>
                <span className={`text-[11px] font-semibold ${
                  bgJustRemoved ? 'text-green-500' : bgStatus === 'no-bg' ? 'text-gray-400' : isRemovingBg ? 'text-slate-600' : bgStatus === 'detecting' ? 'text-gray-400' : 'text-slate-700'
                }`}>
                  {isRemovingBg ? 'Working…' : bgJustRemoved ? 'Removed!' : bgStatus === 'no-bg' ? 'Done' : bgStatus === 'detecting' ? 'Checking…' : 'AI'}
                </span>
              </div>
              {isRemovingBg ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  Removing the background. Hang tight — this usually takes a few seconds.
                </span>
              ) : bgJustRemoved ? (
                <span className="text-[11px] leading-snug text-green-600">
                  Background successfully removed. Image placement and dimensions are unchanged.
                </span>
              ) : bgStatus === 'no-bg' ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  This image already has a transparent background — nothing to remove.
                </span>
              ) : bgStatus === 'detecting' ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  Checking the image for a removable background…
                </span>
              ) : (
                <span className="text-[11px] leading-snug text-gray-600">
                  Uses AI to detect the subject and erase the surrounding background. Best for photos with a clear foreground.
                </span>
              )}
            </div>
          </div>
          </>
          )}

          <Sep />

          <Btn onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" className="!text-gray-500 hover:!text-black hover:!bg-gray-100">
            <RiDeleteBin5Line className="w-5 h-5" />
            <span>Delete</span>
          </Btn>

        </div>
      </div>

      {/* AI progress bar — shown below toolbar during removal */}
      {isRemovingBg && bgProgress && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-md min-w-[220px] max-w-[340px]">
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="text-[10px] font-medium text-slate-700 truncate">{bgProgress.phase}</span>
              <span className="text-[10px] font-semibold text-slate-900 ml-2 flex-shrink-0">{bgProgress.pct}%</span>
            </div>
            <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-slate-900 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${bgProgress.pct}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
