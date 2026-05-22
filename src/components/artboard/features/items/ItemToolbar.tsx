import { MdRotateRight, MdLock, MdLockOpen, MdContentCopy, MdAutoFixHigh } from "react-icons/md";
import { LuFlipHorizontal } from "react-icons/lu";
import { RiDeleteBin5Line } from "react-icons/ri";
import { IoIosLink } from "react-icons/io";

interface ItemToolbarProps {
  locked: boolean;
  onLink: () => void;
  onRotate: () => void;
  onToggleLock: () => void;
  onFlip: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRemoveBg: () => void;
  bgStatus: 'detecting' | 'has-bg' | 'no-bg';
  isRemovingBg: boolean;
  bgProgress?: { phase: string; pct: number } | null;
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

export default function ItemToolbar({ locked, onLink, onRotate, onToggleLock, onFlip, onDuplicate, onDelete, onRemoveBg, bgStatus, isRemovingBg, bgProgress }: ItemToolbarProps) {
  const bgDisabled = bgStatus === 'no-bg' || bgStatus === 'detecting' || isRemovingBg;

  return (
    <div className="pointer-events-auto w-full flex justify-center py-2">
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center px-1 py-1 bg-white border border-gray-200 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-0.5">

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

          <Sep />

          {/* BG Remover */}
          <button
            title={bgStatus === 'no-bg' ? 'Background already removed' : 'BG Remover'}
            disabled={bgDisabled}
            onClick={(e) => { e.stopPropagation(); if (!bgDisabled) onRemoveBg(); }}
            className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-150 select-none ${
              bgStatus === 'no-bg'
                ? 'text-gray-300 cursor-not-allowed'
                : isRemovingBg
                ? 'bg-violet-50 text-violet-400 cursor-wait'
                : 'text-violet-600 hover:text-violet-800 hover:bg-violet-50 active:scale-95 cursor-pointer'
            }`}
          >
            {isRemovingBg ? (
              <>
                <span className="w-5 h-5 border-2 border-violet-300 border-t-violet-500 rounded-full animate-spin" />
                <span className="text-violet-500">Removing…</span>
              </>
            ) : (
              <>
                <MdAutoFixHigh className={`w-5 h-5 ${bgStatus === 'no-bg' ? 'text-gray-300' : 'text-violet-500'}`} />
                <span>{bgStatus === 'no-bg' ? 'BG Removed' : 'BG Remover'}</span>
              </>
            )}
          </button>

          <Sep />

          <Btn onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" className="!text-gray-500 hover:!text-black hover:!bg-gray-100">
            <RiDeleteBin5Line className="w-5 h-5" />
            <span>Delete</span>
          </Btn>

        </div>
      </div>

      {/* AI progress bar — shown below toolbar during removal */}
      {isRemovingBg && bgProgress && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-violet-200 rounded-lg shadow-md min-w-[220px] max-w-[340px]">
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="text-[10px] font-medium text-violet-700 truncate">{bgProgress.phase}</span>
              <span className="text-[10px] font-semibold text-violet-500 ml-2 flex-shrink-0">{bgProgress.pct}%</span>
            </div>
            <div className="h-1 w-full bg-violet-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all duration-300 ease-out"
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
