import { useEffect, useRef, useState } from "react";
import { MdOutlineShoppingCart, MdMenu, MdPerson, MdUndo, MdRedo, MdAddShoppingCart, MdCheckCircle, MdEdit, MdCloudDone, MdCloudUpload, MdErrorOutline, MdCloudOff } from "react-icons/md";
import { FiLayers } from "react-icons/fi";
import { CANVAS } from "../config/artboard.config";
import { usePricingSettings } from "../lib/utils/pricingRates";
import { DpiStatusChip } from "./common/DpiStatus";
type HeaderInfo = {
  hasItem: boolean;
  areaSf?: number;
  /** What the artwork occupies, as opposed to what is billed. */
  usedHeightIn?: number;
  /** The floor a sheet is billed at, shown before anything is placed. */
  minimumAreaSf?: number;
  /** True while the board has no artwork on it. */
  isEmpty?: boolean;
  /** True when the run is shorter than the minimum billable length. */
  atMinimumLength?: boolean;
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

/** Says whether the sheet is saved, in a few words and one icon. */
function SaveStateChip({
  state,
  isSheetSaved,
  onRetry,
  onSignIn,
  errorMessage,
}: {
  state: "idle" | "saving" | "saved" | "error" | "guest";
  isSheetSaved: boolean;
  onRetry?: () => void;
  onSignIn?: () => void;
  errorMessage?: string | null;
}) {
  if (state === "guest") {
    return (
      <button
        onClick={onSignIn}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline"
        title="Sign in and your gang sheets are saved as you work"
      >
        <MdCloudOff className="h-3.5 w-3.5" aria-hidden />
        Not saved — sign in
      </button>
    );
  }
  if (state === "error") {
    return (
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline"
        title={errorMessage || "Your last change could not be saved. Click to try again."}
      >
        <MdErrorOutline className="h-3.5 w-3.5" aria-hidden />
        Not saved
      </button>
    );
  }
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="Saving your gang sheet">
        <MdCloudUpload className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        Saving…
      </span>
    );
  }
  if (state === "saved" || isSheetSaved) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="Saved to your account — find it under Load gang sheet">
        <MdCloudDone className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        Saved
      </span>
    );
  }
  return null;
}

export default function Header({
  info,
  itemCount,
  onMenuClick,
  onCartClick,
  cartCount,
  onAddGangSheetToCart,
  canAddGangSheetToCart,
  cartSheetState = "none",
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onSignInClick,
  isLoggedIn,
  canRenameDesign,
  onRenameDesign,
  saveState = "idle",
  isSheetSaved = false,
  onRetrySave,
  saveErrorMessage,
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
  /**
   * Whether this board is in the cart. It has no "needs updating" state: a sheet
   * in the cart is kept in step with the board, so there is nothing to press.
   */
  cartSheetState?: "none" | "current";
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  onSignInClick?: () => void;
  isLoggedIn?: boolean;
  canRenameDesign?: boolean;
  onRenameDesign?: (newTitle: string) => void;
  /** Whether the sheet is saved, saving, could not be saved, or cannot be (signed out). */
  saveState?: "idle" | "saving" | "saved" | "error" | "guest";
  /** True once the sheet has a saved record — "Saved" means something then. */
  isSheetSaved?: boolean;
  /** Retries after a failed save. */
  onRetrySave?: () => void;
  /** Why the sheet is not saved, shown on hover. */
  saveErrorMessage?: string | null;
  onProfileClick?: () => void;
  profileLabel?: string;
  profileBgClass?: string;
  profileAvatarUrl?: string | null;
  profileName?: string;
  isSidebarOpen?: boolean;
}) {
  const { pricePerSqFt } = usePricingSettings();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!isRenaming) return;
    setRenameValue((info?.name || "Gang Sheet").trim());
  }, [isRenaming, info?.name]);

  const submitRename = () => {
    const next = renameValue.trim();
    // An empty name, or one that did not change, is a no-op — not a rename
    // request and not a toast.
    if (!next || next === (info?.name || "").trim()) {
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
          {info?.hasItem && (
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
              <span className="text-gray-300">|</span>
            </>
          )}
          {itemCount !== undefined && (
            <>
              <ItemCountBadge count={itemCount} />
              <span className="text-gray-300">|</span>
            </>
          )}
          {/* The floor while empty: "0.00sf" says nothing about what the first
              image will cost, and the minimum is the honest answer. */}
          <span title={info?.isEmpty ? "The smallest sheet you can order" : undefined}>
            {(info?.isEmpty ? (info?.minimumAreaSf ?? 0) : (info?.areaSf ?? 0)).toFixed(2)}sf
          </span>
          <span className="text-gray-300">|</span>
          {/*
            The width that is actually priced, not a literal.

            This read "23.50in wide" — the roll width — while the `sf` figure
            beside it, and the price, are computed from the artwork's own
            bounding box. Place one 6x10in graphic and the strip said
            "0.42sf | 23.50in wide x 10.00in long": 23.5 x 10 is 1.63sf, four
            times the area shown next to it. The two numbers described
            different rectangles.

            `info.widthIn` was already being computed and passed in, and simply
            thrown away here.
          */}
          <span
            title={
              info?.atMinimumLength
                ? `Your artwork is ${(info?.usedHeightIn ?? 0).toFixed(2)}in long, but sheets are billed from a ${(info?.heightIn ?? 0).toFixed(0)}in minimum.`
                : "Sheets are cut from a fixed roll width and billed by length"
            }
          >
            {(info?.widthIn ?? 0).toFixed(2)}in wide x{" "}
            {(info?.heightIn ?? 0).toFixed(2)}in long
            {/* Said plainly rather than left as a number that looks wrong: a
                12in sheet reading "10.00in long" is confusing until you know
                the minimum is what set it. */}
            {info?.atMinimumLength && (
              <span className="ml-1 text-[10px] text-gray-400">(min)</span>
            )}
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
              /* Selected on focus so typing replaces the placeholder rather
                 than being appended to "Untitled gang sheet". */
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Gang sheet name"
              maxLength={80}
              className="max-w-xs truncate rounded border border-blue-500 px-2 py-0.5 text-xs text-gray-900 outline-none"
            />
          ) : (
            <span
              className={`inline-flex max-w-xs items-center gap-1 truncate ${canRenameDesign ? "cursor-text hover:text-gray-900" : ""}`}
              title={canRenameDesign ? "Click to rename this gang sheet" : info?.name}
              /* Click, not only double-click: renaming was there but unfindable. */
              onClick={() => {
                if (canRenameDesign) setIsRenaming(true);
              }}
            >
              <span className="truncate">{info?.name || "Gang Sheet"}</span>
              {canRenameDesign && <MdEdit className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />}
            </span>
          )}
          {/*
            Whether the work is safe, in the place the sheet is named.

            Saving used to be a sidebar button, so "is my sheet saved?" had no
            answer on screen at all. Autosave answers it continuously; this is
            where it says so.
          */}
          <SaveStateChip
            state={saveState}
            isSheetSaved={isSheetSaved}
            onRetry={onRetrySave}
            onSignIn={onSignInClick}
            errorMessage={saveErrorMessage}
          />
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
                <span>{info?.atMinimumLength ? "Area (minimum)" : "Area"}</span>
                <span className="font-medium tabular-nums">
                  {(info?.isEmpty ? (info?.minimumAreaSf ?? 0) : (info?.areaSf ?? 0)).toFixed(3)}
                  &nbsp;sq&nbsp;ft
                </span>
              </span>
              {/*
                Said outright rather than left to be inferred from a number that
                does not match the artwork. A sheet is billed as the full roll
                width by its length, floored at the minimum — without this the
                breakdown looks like it is charging for space the customer did
                not use, with no explanation.
              */}
              {info?.atMinimumLength && (
                <span className="text-[11px] leading-snug text-gray-400">
                  {info?.isEmpty
                    ? `Sheets start at ${(info?.widthIn ?? 0).toFixed(2)}in x ${(info?.heightIn ?? 0).toFixed(0)}in.`
                    : `Your artwork is ${(info?.usedHeightIn ?? 0).toFixed(2)}in long; sheets are billed from a ${(info?.heightIn ?? 0).toFixed(0)}in minimum.`}
                </span>
              )}
              <span className="mt-1 flex justify-between gap-4 border-t border-gray-100 pt-1.5 text-[12px] font-semibold text-gray-900">
                <span>{info?.isEmpty ? "Minimum" : "Total"}</span>
                <span className="tabular-nums">
                  ${(info?.isEmpty
                    ? (info?.minimumAreaSf ?? 0) * pricePerSqFt
                    : (info?.price ?? 0)
                  ).toFixed(2)}
                </span>
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
              : cartSheetState === "current"
              ? "This sheet is in your cart and updates with it — open the cart (C)"
              : "Add current gangsheet to cart (C)"
          }
          className={`inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-0 text-xs font-medium rounded-2xl border transition-colors ${
            canAddGangSheetToCart === false
              ? "text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed"
              : "text-black bg-white border-gray-300 hover:bg-gray-50 cursor-pointer"
          }`}
        >
          {cartSheetState === "current" ? (
            <MdCheckCircle className="w-4 h-4 sm:hidden" />
          ) : (
            <MdAddShoppingCart className="w-4 h-4 sm:hidden" />
          )}
          <span className="hidden sm:inline">{cartSheetState === "current" ? "In Cart" : "Add to Cart"}</span>
        </button>

        {/*
          Shown signed out too.
          
          Add to Cart has always worked without an account, but the cart icon
          was hidden until you signed in — so a visitor could fill a cart and
          then have no way to open it. Browsing and building a basket before
          signing in is the norm; the sign-in belongs at checkout, which is
          where the order and the payment actually need an account.
        */}
        <button
          onClick={onCartClick}
          aria-label={cartCount ? `Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}` : "Cart, empty"}
          title="View cart"
          className="p-2 text-gray-600 hover:text-gray-900 transition-colors relative cursor-pointer"
        >
          <MdOutlineShoppingCart size={24} />
          {cartCount !== undefined && cartCount > 0 && (
            <span className="absolute top-1 right-1 bg-black text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-semibold">
              {cartCount}
            </span>
          )}
        </button>
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
