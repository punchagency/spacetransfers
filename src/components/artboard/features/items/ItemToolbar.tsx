import { MdRotateRight, MdLock, MdLockOpen, MdContentCopy, MdAutoFixHigh, MdHighQuality, MdCheckCircle } from "react-icons/md";
import { LuFlipHorizontal } from "react-icons/lu";
import { RiDeleteBin5Line } from "react-icons/ri";
import { MdGroupWork, MdOutlineWorkspaces } from "react-icons/md";
import { HiOutlineSparkles } from "react-icons/hi2";
import { useIsMobile } from "../../../../lib/useIsMobile";
import type { SelectionSummary } from "../../types";

interface ItemToolbarProps {
  locked: boolean;
  /** Bundles the selection into a group, or splits the selected group. */
  onGroup: () => void;
  groupAction: "group" | "ungroup" | null;
  onRotate: () => void;
  onToggleLock: () => void;
  onFlip: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onIncreaseDpi: () => void;
  currentDpi?: number;
  isDpiUnknown?: boolean;
  isDpiEnhancing?: boolean;
  /** "Image 2 of 3 · Enhancing…" while DPI+ works through several images. */
  dpiProgress?: string | null;
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
  /** The whole selection — DPI+ and BG removal act on all of it, AI on one image. */
  selection?: SelectionSummary;
}

const Btn = ({ onClick, title, className = "", disabled = false, children }: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <button
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] font-medium select-none transition-all duration-100 ${
      disabled
        ? "text-gray-300 cursor-not-allowed"
        : "text-gray-500 hover:text-gray-900 hover:bg-gray-100 active:scale-95 cursor-pointer"
    } ${className}`}
  >
    {children}
  </button>
);

/** Why a control is off on a locked image — the same words everywhere. */
const UNLOCK_TO_EDIT = "Locked — unlock to edit";

const Sep = () => <span className="w-px h-6 bg-gray-200 flex-shrink-0 mx-0.5" />;

export default function ItemToolbar({ locked, onGroup, groupAction, onRotate, onToggleLock, onFlip, onDuplicate, onDelete, onIncreaseDpi, currentDpi, isDpiUnknown, isDpiEnhancing, dpiProgress, dpiEnhanced, onRemoveBg, bgStatus, isRemovingBg, bgProgress, bgJustRemoved, onOpenAi, aiActive, selection }: ItemToolbarProps) {
  const isMobile = useIsMobile();
  // With several images selected, DPI+ and the BG remover work through all of
  // them (skipping locked ones and ones that don't need it), so their state
  // comes from the whole selection rather than the image the bar hangs off.
  // AI rewrites one image from a prompt, so it stays single-image.
  const multi = (selection?.count ?? 1) > 1;
  const multiCount = selection?.count ?? 1;
  const multiEditable = selection?.editable ?? 0;
  const multiLowDpi = selection?.lowDpi ?? 0;
  // A locked image can only be unlocked or duplicated; everything else waits.
  const bgLocked = multi ? multiEditable === 0 : locked;
  const bgDisabled = multi
    ? bgLocked || isRemovingBg
    : locked || bgStatus === 'no-bg' || bgStatus === 'detecting' || isRemovingBg || bgJustRemoved;
  const dpiMeetsMinimum = multi
    ? multiLowDpi === 0
    : typeof currentDpi === "number" && currentDpi >= 300;
  const isLowDpi = multi ? multiLowDpi > 0 : (typeof currentDpi === "number" && currentDpi < 300) || !!isDpiUnknown;
  const aiDisabled = locked || multi;
  // dpiMeetsMinimum alone gates re-enabling — it's derived fresh from the
  // item's CURRENT print size every render, so it correctly flips back to
  // false (re-enabling the button) if the user scales the item larger again
  // after a previous enhancement. dpiEnhanced is only a "just did this"
  // display flag (see the reset effect in ArtboardItem) and must never be
  // the thing keeping the button disabled once DPI has actually dropped again.
  const dpiLocked = multi ? multiEditable === 0 : locked;
  const dpiButtonDisabled = dpiLocked || dpiMeetsMinimum || isDpiEnhancing;
  // "Just did this" ticks describe one image; with several selected they'd mislead.
  const showDpiDone = !multi && dpiEnhanced;
  const showBgDone = !multi && bgJustRemoved;
  const plural = (n: number) => `${n} image${n === 1 ? "" : "s"}`;

  return (
    // Clicks pass through everywhere but the bar itself. This wrapper spans the
    // sheet's full width, and with `pointer-events-auto` here it swallowed every
    // click along the top of the sheet while anything was selected — artwork
    // there could not be selected, right-clicked or dragged.
    <div className="pointer-events-none w-full flex justify-center py-2">
    <div className="flex flex-col items-center gap-1">
      <div data-action-toolbar className="pointer-events-auto flex items-center px-1 py-1 bg-white border border-gray-200 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] max-md:max-w-[calc(100vw-1rem)] max-md:overflow-x-auto">
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
                onClick={(e) => { e.stopPropagation(); if (!aiDisabled) onOpenAi(); }}
                disabled={aiDisabled}
                title={
                  multi
                    ? "AI edits one image at a time — select a single image"
                    : locked ? UNLOCK_TO_EDIT : "Edit with AI"
                }
                aria-pressed={aiActive}
                className={`ai-tool-btn group/ai relative flex flex-col items-center justify-center gap-0.5 px-3 py-1 mr-0.5 rounded-[10px] text-[10px] font-bold text-white overflow-hidden select-none transition-transform duration-200 ease-out ${
                  aiDisabled ? "opacity-40 grayscale cursor-not-allowed" : "cursor-pointer hover:-translate-y-[1px] hover:scale-[1.06] active:scale-95"
                } ${
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

          {/* Group bundles pieces so they are selected, moved, nested, turned and
              flipped as one. With a single loose piece there is nothing to group
              with, and the button says how to select more. */}
          <div className="relative group/grp">
            <Btn
              onClick={(e) => { e.stopPropagation(); if (groupAction) onGroup(); }}
              disabled={locked || !groupAction}
            >
              {groupAction === "ungroup" ? <MdOutlineWorkspaces className="w-5 h-5" /> : <MdGroupWork className="w-5 h-5" />}
              <span>{groupAction === "ungroup" ? "Ungroup" : "Group"}</span>
            </Btn>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover/grp:flex flex-col gap-1 w-60 rounded-xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.12)] px-3 py-2.5 pointer-events-none z-50">
              <span className="text-[12px] font-semibold text-gray-900">
                {groupAction === "ungroup" ? "Ungroup" : groupAction === "group" ? `Group ${plural(multiCount)}` : "Group images"}
              </span>
              {locked ? (
                <span className="text-[11px] leading-snug text-gray-600">{UNLOCK_TO_EDIT}.</span>
              ) : groupAction === "ungroup" ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  Splits this group back into separate images you can move on their own.
                </span>
              ) : groupAction === "group" ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  Bundles the selected images so they <span className="font-semibold text-gray-900">move, auto-nest, rotate and flip as one</span>. Clicking any of them selects the whole group.
                </span>
              ) : (
                <span className="text-[11px] leading-snug text-gray-600">
                  Hold <kbd className="px-1 py-px rounded border border-gray-300 bg-gray-50 text-[10px] font-semibold text-gray-800">Shift</kbd> and click two or more images to select them, then click Group. Grouped images move, auto-nest, rotate and flip as one.
                </span>
              )}
            </div>
          </div>

          <Sep />

          <Btn onClick={(e) => { e.stopPropagation(); onRotate(); }} title={locked ? UNLOCK_TO_EDIT : "Rotate"} disabled={locked}>
            <MdRotateRight className="w-5 h-5" />
            <span>Rotate</span>
          </Btn>

          <Btn onClick={(e) => { e.stopPropagation(); onFlip(); }} title={locked ? UNLOCK_TO_EDIT : "Flip"} disabled={locked}>
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
                  : showDpiDone
                  ? "text-green-500 cursor-not-allowed"
                  : dpiLocked || dpiMeetsMinimum
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
              ) : showDpiDone ? (
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
                  {isDpiEnhancing ? "Enhancing…" : showDpiDone ? "Enhanced" : "Enhance DPI"}
                </span>
                {multi ? (
                  <span className={`text-[11px] font-semibold ${isLowDpi ? "text-[#EDAE00]" : "text-gray-500"}`}>
                    {multiLowDpi} of {multiCount} low
                  </span>
                ) : !dpiEnhanced && isDpiUnknown ? (
                  <span className="text-[11px] font-semibold text-[#EDAE00]">DPI Unknown</span>
                ) : typeof currentDpi === "number" && (
                  <span className={`text-[11px] font-semibold ${dpiEnhanced ? "text-green-500" : isLowDpi ? "text-[#EDAE00]" : "text-gray-500"}`}>
                    {dpiEnhanced ? "300" : currentDpi} DPI
                  </span>
                )}
              </div>
              {dpiLocked ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  {multi ? "All the selected images are locked — unlock them to edit." : `${UNLOCK_TO_EDIT}.`}
                </span>
              ) : isDpiEnhancing ? (
                <span className="text-[11px] leading-snug text-amber-600">
                  {dpiProgress ? `${dpiProgress} ` : ""}Upscaling to 300 DPI — hold tight…
                </span>
              ) : multi ? (
                dpiMeetsMinimum ? (
                  <span className="text-[11px] leading-snug text-gray-500">
                    Every unlocked image selected is already at 300 DPI or more — nothing to enhance.
                  </span>
                ) : (
                  <span className="text-[11px] leading-snug text-gray-600">
                    <span className="font-semibold text-[#C68A00]">One click upscales the {plural(multiLowDpi)} below 300 DPI</span>, each to 300 DPI at its print size. Images already at 300 DPI{multiEditable < multiCount ? " and locked ones" : ""} are left as they are.
                  </span>
                )
              ) : showDpiDone ? (
                <span className="text-[11px] leading-snug text-green-600">
                  Image successfully enhanced to <span className="font-semibold">300 DPI</span>. No further enhancement needed.
                </span>
              ) : dpiMeetsMinimum ? (
                <span className="text-[11px] leading-snug text-gray-500">
                  Already at 300 DPI or more at this size — nothing to enhance.
                </span>
              ) : (
                /*
                 * Said as it is: this upscales the pixels at the same print size.
                 * It smooths visible pixelation; it cannot invent detail the file
                 * never had. "Keeps print quality crisp" promised more than that.
                 */
                <span className="text-[11px] leading-snug text-gray-600">
                  {isDpiUnknown ? "This image's resolution couldn't be read. " : "Below 300 DPI at this size. "}
                  <span className="font-semibold text-[#C68A00]">One click upscales it to 300 DPI</span> at the same print size — smoothing pixelation, though it can't add detail the original doesn't have.
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
                showBgDone
                  ? 'text-green-500 cursor-not-allowed'
                  : isRemovingBg
                  ? 'bg-gray-100 text-gray-400 cursor-wait'
                  : bgLocked || (!multi && bgStatus === 'no-bg')
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-gray-100 active:scale-95 cursor-pointer'
              }`}
            >
              {isRemovingBg ? (
                <>
                  <span className="w-5 h-5 border-2 border-gray-300 border-t-slate-900 rounded-full animate-spin" />
                  <span className="text-slate-600">Removing…</span>
                </>
              ) : showBgDone ? (
                <>
                  <MdCheckCircle className="w-5 h-5 text-green-500" />
                  <span>BG Done</span>
                </>
              ) : (
                <>
                  <MdAutoFixHigh className={`w-5 h-5 ${bgDisabled ? 'text-gray-300' : 'text-slate-700'}`} />
                  {/* "BG Removed" on an image that never had one described something that did not happen. */}
                  <span>{!multi && bgStatus === 'no-bg' ? 'No BG' : 'BG Remover'}</span>
                </>
              )}
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover/bg:flex flex-col gap-1 w-60 rounded-xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.12)] px-3 py-2.5 pointer-events-none z-50">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-gray-900">Background Remover</span>
                <span className={`text-[11px] font-semibold ${
                  showBgDone ? 'text-green-500' : multi ? 'text-slate-700' : bgStatus === 'no-bg' ? 'text-gray-400' : isRemovingBg ? 'text-slate-600' : bgStatus === 'detecting' ? 'text-gray-400' : 'text-slate-700'
                }`}>
                  {bgLocked ? 'Locked' : isRemovingBg ? 'Working…' : multi ? plural(multiEditable) : bgJustRemoved ? 'Removed!' : bgStatus === 'no-bg' ? 'Transparent' : bgStatus === 'detecting' ? 'Checking…' : 'AI'}
                </span>
              </div>
              {bgLocked ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  {multi ? "All the selected images are locked — unlock them to edit." : `${UNLOCK_TO_EDIT}.`}
                </span>
              ) : isRemovingBg ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  {multi ? "Removing backgrounds one image at a time. Hang tight — each usually takes a few seconds." : "Removing the background. Hang tight — this usually takes a few seconds."}
                </span>
              ) : multi ? (
                <span className="text-[11px] leading-snug text-gray-600">
                  Uses AI to erase the background from each selected image that has one, one after another. Images that are already transparent{multiEditable < multiCount ? " and locked ones" : ""} are skipped.
                </span>
              ) : bgJustRemoved ? (
                /* The box shrinks to the subject — "dimensions are unchanged" said otherwise. */
                <span className="text-[11px] leading-snug text-green-600">
                  Background removed. The subject keeps its size and place; the empty space around it is trimmed.
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

          <Btn onClick={(e) => { e.stopPropagation(); onDelete(); }} title={locked ? UNLOCK_TO_EDIT : "Delete"} disabled={locked}>
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
