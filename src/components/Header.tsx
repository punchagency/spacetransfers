import { useEffect, useRef, useState } from "react";
import { MdOutlineShoppingCart, MdMenu, MdOutlineSaveAlt, MdPerson, MdUndo, MdRedo, MdAddShoppingCart } from "react-icons/md";
import { FiLayers } from "react-icons/fi";
import { CANVAS } from "../config/artboard.config";
import { usePricePerSqFt } from "../lib/utils/pricingRates";
import { DpiStatusChip } from "./common/DpiStatus";
type HeaderInfo = {
  hasItem: boolean;
  areaSf?: number;
  widthIn?: number;
  heightIn?: number;
  name?: string;
  price?: number;
  imageNames?: string[];
  lowDpiCount?: number;
  unknownDpiCount?: number;
};

function ItemCountBadge({ count }: { count: number }) {
  const [bumped, setBumped] = useState(false);
  const prevRef = useRef(count);

  useEffect(() => {
    if (count === prevRef.current) return;
    prevRef.current = count;
    setBumped(true);
    const t = setTimeout(() => setBumped(false), 380);
    return () => clearTimeout(t);
  }, [count]);

  return (
    <div
      className={`relative flex items-center gap-1.5 px-3 py-[3px] rounded-full text-[11px] font-semibold select-none transition-all duration-200 ease-out ${
        bumped ? "scale-[1.18]" : "scale-100"
      } ${
        count > 0
          ? "bg-slate-900 text-white shadow-[0_2px_10px_rgba(15,23,42,0.35)]"
          : "bg-gray-100 text-gray-400"
      }`}
    >
      {/* ripple ring on count change */}
      {bumped && count > 0 && (
        <span className="absolute inset-0 rounded-full ring-2 ring-slate-600/60 animate-ping pointer-events-none" />
      )}
      <FiLayers className={`w-3 h-3 flex-shrink-0 ${count > 0 ? "text-white/75" : "text-gray-400"}`} />
      <span className="tabular-nums tracking-tight leading-none">{count}</span>
      <span className={`text-[9px] font-medium uppercase tracking-widest leading-none ${count > 0 ? "text-white/45" : "text-gray-400"}`}>
        pcs
      </span>
    </div>
  );
}

export default function Header({
  info,
  itemCount,
  onMenuClick,
  onCartClick,
  cartCount,
  onAddGangSheetToCart,
  canAddGangSheetToCart,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onSignInClick,
  isLoggedIn,
  onSaveLoaded,
  canSaveLoaded,
  canRenameDesign,
  onRenameDesign,
  onProfileClick,
  profileLabel,
  profileBgClass,
  profileAvatarUrl,
  profileName,
  isSidebarOpen,
  onToggleDpiHighlight,
  isDpiHighlighting,
}: {
  info?: HeaderInfo;
  itemCount?: number;
  onMenuClick?: () => void;
  onCartClick?: () => void;
  /** Reveals the flagged artwork on the sheet. See `DpiStatusChip`. */
  onToggleDpiHighlight?: () => void;
  isDpiHighlighting?: boolean;
  cartCount?: number;
  onAddGangSheetToCart?: () => void;
  canAddGangSheetToCart?: boolean;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  onSignInClick?: () => void;
  isLoggedIn?: boolean;
  onSaveLoaded?: () => void;
  canSaveLoaded?: boolean;
  canRenameDesign?: boolean;
  onRenameDesign?: (newTitle: string) => void;
  onProfileClick?: () => void;
  profileLabel?: string;
  profileBgClass?: string;
  profileAvatarUrl?: string | null;
  profileName?: string;
  isSidebarOpen?: boolean;
}) {
  const pricePerSqFt = usePricePerSqFt();
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
    <header className="flex items-center justify-between px-3 md:px-6 h-10 bg-white border-b border-gray-200">
      <div className="flex items-center min-w-0">
        <span className="text-base md:text-xl font-bold tracking-tight text-slate-900 truncate">
          spacetransfers
        </span>
        <img src="/space.svg" alt="space" className="w-9 h-9 md:w-12 md:h-12 -scale-x-100 flex-shrink-0" />
      </div>

      <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
        <div className="hidden md:flex items-center gap-3 text-xs text-gray-800">
          {(info?.hasItem || onSaveLoaded) && (
            <>
              {info?.hasItem && (
                <>
                  <button
                    onClick={onUndo}
                    disabled={!canUndo}
                    className={`inline-flex items-center justify-center rounded px-1 ${canUndo
                      ? "hover:bg-gray-100 cursor-pointer"
                      : "opacity-40 pointer-events-none"
                      }`}
                    aria-label="Undo"
                    title="Undo (Ctrl+Z)"
                  >
                    <MdUndo className="inline-block w-4 h-4" />
                  </button>
                  <button
                    onClick={onRedo}
                    disabled={!canRedo}
                    className={`inline-flex items-center justify-center rounded px-1 ${canRedo
                      ? "hover:bg-gray-100 cursor-pointer"
                      : "opacity-40 pointer-events-none"
                      }`}
                    aria-label="Redo"
                    title="Redo (Ctrl+Shift+Z)"
                  >
                    <MdRedo className="inline-block w-4 h-4" />
                  </button>
                </>
              )}
              {onSaveLoaded && (
                <button
                  onClick={onSaveLoaded}
                  disabled={!canSaveLoaded}
                  className={`inline-flex items-center justify-center rounded px-1 ml-1 ${canSaveLoaded
                    ? "text-black hover:bg-gray-100 cursor-pointer"
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
          {itemCount !== undefined && (
            <>
              <ItemCountBadge count={itemCount} />
              <span className="text-gray-300">|</span>
            </>
          )}
          <span>{(info?.areaSf ?? 0).toFixed(2)}sf</span>
          <span className="text-gray-300">|</span>
          <span>
            23.50in wide x{" "}
            {(info?.heightIn ?? CANVAS.SHEET_HEIGHT_IN).toFixed(2)}in long
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
          {/* One chip for both conditions. Two separate amber discs could be on
              screen at once, each with its own red count bubble, which is the
              clutter this replaces — the split now lives in the tooltip. The
              chip returns null when there is nothing to report, so the divider
              below is conditional on the same total. */}
          <DpiStatusChip
            lowDpiCount={info?.lowDpiCount ?? 0}
            unknownDpiCount={info?.unknownDpiCount ?? 0}
            onToggleHighlight={onToggleDpiHighlight}
            isHighlighting={isDpiHighlighting}
          />
          {(info?.lowDpiCount ?? 0) + (info?.unknownDpiCount ?? 0) > 0 && (
            <span className="text-gray-300">|</span>
          )}
          <span
            className="relative cursor-default group"
            tabIndex={0}
          >
            ${(info?.price ?? 0).toFixed(2)}
            <span className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[9999] hidden group-hover:flex group-focus:flex flex-col gap-1.5 min-w-[172px] rounded-xl border border-gray-200 bg-white shadow-lg px-4 py-3 text-left pointer-events-none">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Pricing Breakdown</span>
              <span className="flex justify-between gap-4 text-[12px] text-gray-700">
                <span>Rate</span>
                <span className="font-medium tabular-nums">${pricePerSqFt.toFixed(2)}&nbsp;/&nbsp;sq&nbsp;ft</span>
              </span>
              <span className="flex justify-between gap-4 text-[12px] text-gray-700">
                <span>Area</span>
                <span className="font-medium tabular-nums">{(info?.areaSf ?? 0).toFixed(3)}&nbsp;sq&nbsp;ft</span>
              </span>
              <span className="mt-1 flex justify-between gap-4 border-t border-gray-100 pt-1.5 text-[12px] font-semibold text-gray-900">
                <span>Total</span>
                <span className="tabular-nums">${(info?.price ?? 0).toFixed(2)}</span>
              </span>
            </span>
          </span>
        </div>
        {!isLoggedIn ? (
          <button
            onClick={onSignInClick}
            className="px-3 text-xs font-medium rounded-2xl text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            Sign In
          </button>
        ) : null}
        <button
          onClick={onAddGangSheetToCart}
          disabled={canAddGangSheetToCart === false}
          title={
            canAddGangSheetToCart === false
              ? "Add items to the artboard before adding to cart"
              : "Add current gangsheet to cart"
          }
          className={`inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-0 text-xs font-medium rounded-2xl border transition-colors ${
            canAddGangSheetToCart === false
              ? "text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed"
              : "text-black bg-white border-gray-300 hover:bg-gray-50 cursor-pointer"
          }`}
        >
          <MdAddShoppingCart className="w-4 h-4 sm:hidden" />
          <span className="hidden sm:inline">Add to Cart</span>
        </button>

        {isLoggedIn ? (
          <button
            onClick={onCartClick}
            className="p-2 text-gray-600 hover:text-gray-900 transition-colors relative cursor-pointer"
          >
            <MdOutlineShoppingCart size={24} />
            {cartCount !== undefined && cartCount > 0 && (
              <span className="absolute top-1 right-1 bg-black text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-semibold">
                {cartCount}
              </span>
            )}
          </button> 
        ) : null}
        {isLoggedIn ? (
          <button
            onClick={onProfileClick}
            className="hidden md:flex items-center gap-2 px-1 py-1 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Account"
            title={profileName || "Account"}
          >
            {profileAvatarUrl ? (
              <img
                src={profileAvatarUrl}
                alt={profileName || ""}
                className="w-7 h-7 rounded-full object-cover ring-2 ring-white shadow-sm"
                referrerPolicy="no-referrer"
              />
            ) : profileLabel ? (
              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-[11px] font-semibold ${profileBgClass || "bg-slate-900"}`}>
                {profileLabel}
              </span>
            ) : (
              <MdPerson size={22} />
            )}
            {profileName && (
              <span className="hidden md:block text-[12px] font-medium text-gray-700 max-w-[120px] truncate">
                {profileName.split(" ")[0]}
              </span>
            )}
          </button>
        ) : null}
        <button
          onClick={onMenuClick}
          onMouseEnter={onMenuClick}
          className="p-2 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer w-10 h-10 flex items-center justify-center"
          aria-label="Open menu"
        >
          <MdMenu size={24} />
        </button>
      </div>
    </header>
  );
}
