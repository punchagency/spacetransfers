import { useEffect, useState } from "react";
import { MdOutlineShoppingCart, MdMenu, MdOutlineSaveAlt } from "react-icons/md";
import { GrRedo } from "react-icons/gr";
type HeaderInfo = {
  hasItem: boolean;
  areaSf?: number;
  widthIn?: number;
  heightIn?: number;
  name?: string;
  price?: number;
  imageNames?: string[];
};

export default function Header({
  info,
  onMenuClick,
  onCartClick,
  cartCount,
  onAddGangSheetToCart,
  onRedo,
  canRedo,
  onSignInClick,
  isLoggedIn,
  onSaveLoaded,
  canSaveLoaded,
  canRenameDesign,
  onRenameDesign,
}: {
  info?: HeaderInfo;
  onMenuClick?: () => void;
  onCartClick?: () => void;
  cartCount?: number;
  onAddGangSheetToCart?: () => void;
  onRedo?: () => void;
  canRedo?: boolean;
  onSignInClick?: () => void;
  isLoggedIn?: boolean;
  onSaveLoaded?: () => void;
  canSaveLoaded?: boolean;
  canRenameDesign?: boolean;
  onRenameDesign?: (newTitle: string) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!isRenaming) return;
    setRenameValue((info?.name || "Gang Sheet").trim());
  }, [isRenaming, info?.name]);

  const submitRename = () => {
    const next = renameValue.trim();
    if (!next) {
      setIsRenaming(false);
      return;
    }
    onRenameDesign?.(next);
    setIsRenaming(false);
  };

  return (
    <header className="flex items-center justify-between px-6 h-10 bg-white border-b border-gray-200">
      <div className="flex items-center ">
        <span className="text-xl font-bold tracking-tight text-slate-900">
          spacetransfers
        </span>
        <img src="/space.svg" alt="space" className="w-12 h-12" />
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center gap-3 text-xs text-gray-800">
          {(info?.hasItem || onSaveLoaded) && (
            <>
              {info?.hasItem && (
                <button
                  onClick={onRedo}
                  disabled={!canRedo}
                  className={`inline-flex items-center justify-center rounded px-1 ${canRedo
                    ? "hover:bg-gray-100"
                    : "opacity-40 pointer-events-none"
                    }`}
                  aria-label="Redo last action"
                >
                  <GrRedo className="inline-block w-3.5 h-3.5" />
                </button>
              )}
              {onSaveLoaded && (
                <button
                  onClick={onSaveLoaded}
                  disabled={!canSaveLoaded}
                  className={`inline-flex items-center justify-center rounded px-1 ml-1 ${canSaveLoaded
                    ? "text-black hover:bg-gray-100"
                    : "text-black opacity-40 pointer-events-none"
                    }`}
                  aria-label="Save changes"
                  title="Save gangsheet changes"
                >
                  <MdOutlineSaveAlt className="inline-block w-4 h-4" />
                </button>
              )}
              <span className="text-gray-300">|</span>
            </>
          )}
          <span>{(info?.areaSf ?? 3.25).toFixed(2)}sf</span>
          <span className="text-gray-300">|</span>
          <span>
            {(info?.widthIn ?? 24).toFixed(2)}in wide x{" "}
            {(info?.heightIn ?? 19.5).toFixed(2)}in long
          </span>
          <span className="text-gray-300">|</span>
          {isRenaming ? (
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setIsRenaming(false);
              }}
              autoFocus
              className="max-w-xs truncate rounded border border-blue-500 px-2 py-0.5 text-xs text-gray-900 outline-none"
            />
          ) : (
            <span
              className={`max-w-xs truncate ${canRenameDesign ? "cursor-text" : ""}`}
              title={canRenameDesign ? "Double-click to rename" : info?.name}
              onDoubleClick={() => {
                if (canRenameDesign) setIsRenaming(true);
              }}
            >
              {info?.name || "Gang Sheet"}
            </span>
          )}
          <span className="text-gray-300">|</span>
          <span>${(info?.price ?? 0).toFixed(2)}</span>
        </div>
        {!isLoggedIn ? (
          <button
            onClick={onSignInClick}
            className="px-3 text-xs font-medium rounded-2xl text-slate-600 hover:text-slate-900 transition-colors"
          >
            Sign In
          </button>
        ) : null}
        <button
          onClick={onAddGangSheetToCart}
          className="px-3 text-xs font-medium rounded-2xl text-black bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          Add to Cart
        </button>
        {isLoggedIn ? (
          <button
            onClick={onCartClick}
            className="p-2 text-gray-600 hover:text-gray-900 transition-colors relative"
          >
            <MdOutlineShoppingCart size={24} />
            {cartCount !== undefined && cartCount > 0 && (
              <span className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-semibold">
                {cartCount}
              </span>
            )}
          </button>
        ) : null}

        <button
          onClick={onMenuClick}
          className="p-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <MdMenu size={24} />
        </button>
      </div>
    </header>
  );
}
