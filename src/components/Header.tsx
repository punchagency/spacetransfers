import { useEffect, useRef, useState } from "react";
import { useCanHover } from "../lib/useIsMobile";
import { MdOutlineShoppingCart, MdMenu, MdPerson, MdUndo, MdRedo, MdAddShoppingCart, MdCheckCircle, MdSync, MdExpandMore, MdEdit, MdCloudDone, MdCloudUpload, MdErrorOutline, MdCloudOff } from "react-icons/md";
import { FiLayers } from "react-icons/fi";
import { usePricingSettings } from "../lib/utils/pricingRates";
import { DpiStatusChip } from "./common/DpiStatus";
import { TransparencyChip } from "./common/TransparencyStatus";
import { UploadIssueChip } from "./common/UploadStatus";
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
  quiet = false,
}: {
  /** Icon only while things are fine: on a phone the issue chips need the room, and the sheet's name more so. */
  quiet?: boolean;
  state: "idle" | "saving" | "saved" | "partial" | "error" | "guest";
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
        <MdCloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {/* The long form needs room the phone's strip does not have — it was
            squeezing the sheet's name down to one letter. */}
        <span className="whitespace-nowrap">Not saved<span className="hidden sm:inline"> — sign in</span></span>
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
  if (state === "partial") {
    // Icon only: the red chip beside it carries the count and the words, and
    // two phrases side by side pushed the brand name out of the bar.
    return (
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline"
        title="Your sheet is saved without the images that didn't upload. Click to send them again."
      >
        <MdCloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Saved without the images that didn't upload</span>
      </button>
    );
  }
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="Saving your gang sheet">
        <MdCloudUpload className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        {quiet ? <span className="sr-only">Saving…</span> : "Saving…"}
      </span>
    );
  }
  if (state === "saved" || isSheetSaved) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="Saved to your account — find it under Load gang sheet">
        <MdCloudDone className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        {quiet ? <span className="sr-only">Saved</span> : "Saved"}
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
  onSaveAsNewSheet,
  cartActionBusy = false,
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
  transparency,
  notUploadedCount = 0,
  onGoToIssue,
}: {
  info?: HeaderInfo;
  itemCount?: number;
  onMenuClick?: () => void;
  onCartClick?: () => void;
  /** Images whose transparency DTF can't print as shown, by kind. */
  transparency?: { fade: number; seeThrough: number };
  /** Goes to the next image with that kind of issue on the sheet. */
  onGoToIssue?: (kind: "dpi" | "transparency" | "upload") => void;
  /** Images on the sheet that did not upload. */
  notUploadedCount?: number;
  cartCount?: number;
  onAddGangSheetToCart?: () => void;
  canAddGangSheetToCart?: boolean;
  /**
   * Whether this board is in the cart. It has no "needs updating" state: a sheet
   * in the cart is kept in step with the board, so there is nothing to press.
   */
  cartSheetState?: "none" | "current" | "changed";
  /** Turns the changed board into a sheet of its own, leaving the cart's version alone. */
  onSaveAsNewSheet?: () => void;
  cartActionBusy?: boolean;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  onSignInClick?: () => void;
  isLoggedIn?: boolean;
  canRenameDesign?: boolean;
  onRenameDesign?: (newTitle: string) => void;
  /** Whether the sheet is saved, saving, could not be saved, or cannot be (signed out). */
  saveState?: "idle" | "saving" | "saved" | "partial" | "error" | "guest";
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
  const canHover = useCanHover();
  const [isRenaming, setIsRenaming] = useState(false);
  const [cartMenuOpen, setCartMenuOpen] = useState(false);
  const cartMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cartMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !cartMenuRef.current?.contains(e.target as Node)) {
        setCartMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [cartMenuOpen]);
  useEffect(() => {
    if (cartSheetState !== "changed") setCartMenuOpen(false);
  }, [cartSheetState]);
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

  /**
   * The sheet's name, and renaming it.
   *
   * Written once and used twice: the desktop strip and the phone strip below it
   * show the same control, and a name you can see but not rename on a phone
   * would be a worse answer than not showing it at all.
   */
  const nameControl = (widthClass: string) =>
    isRenaming ? (
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
        className={`${widthClass} min-w-0 truncate rounded border border-blue-500 px-2 py-0.5 text-xs text-gray-900 outline-none`}
      />
    ) : (
      <span
        className={`inline-flex ${widthClass} min-w-0 items-center gap-1 truncate ${canRenameDesign ? "cursor-text hover:text-gray-900" : ""}`}
        title={canRenameDesign ? "Click to rename this gang sheet" : info?.name}
        /* Click, not only double-click: renaming was there but unfindable. */
        onClick={() => {
          if (canRenameDesign) setIsRenaming(true);
        }}
      >
        <span className="truncate">{info?.name || "Gang Sheet"}</span>
        {canRenameDesign && <MdEdit className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />}
      </span>
    );

  return (
    <header className="flex flex-col md:flex-row md:items-center md:justify-between px-3 md:px-6 md:h-10 bg-white border-b border-gray-200">
      {/* One row on a laptop, two on a phone: `contents` dissolves this wrapper
          at md and up, so the desktop header is laid out exactly as before. */}
      <div className="flex h-10 items-center justify-between gap-2 md:contents">
      {/* The name fits on a 375px phone: it was truncating to "spacetrans…"
          beside a rocket wide enough to push it out. */}
      <div className="flex items-center min-w-0">
        <span className="text-[15px] md:text-xl font-bold tracking-tight text-slate-900 truncate">
          spacetransfers
        </span>
        <img src="/space.svg" alt="space" className="w-7 h-7 md:w-12 md:h-12 -scale-x-100 flex-shrink-0" />
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
          {nameControl("max-w-xs")}
          <SaveStateChip
            state={saveState}
            isSheetSaved={isSheetSaved}
            onRetry={onRetrySave}
            onSignIn={onSignInClick}
            errorMessage={saveErrorMessage}
          />
          <span className="text-gray-300">|</span>
          {/* One chip per kind of issue, each in the colour its artwork is
              outlined in on the sheet. A chip renders nothing at zero, so the
              divider after them is conditional on the same totals. */}
          <UploadIssueChip count={notUploadedCount} onGoTo={onGoToIssue ? () => onGoToIssue("upload") : undefined} />
          <DpiStatusChip
            lowDpiCount={info?.lowDpiCount ?? 0}
            unknownDpiCount={info?.unknownDpiCount ?? 0}
            onGoTo={onGoToIssue ? () => onGoToIssue("dpi") : undefined}
          />
          <TransparencyChip
            fadeCount={transparency?.fade ?? 0}
            seeThroughCount={transparency?.seeThrough ?? 0}
            onGoTo={onGoToIssue ? () => onGoToIssue("transparency") : undefined}
          />
          {notUploadedCount + (info?.lowDpiCount ?? 0) + (info?.unknownDpiCount ?? 0) + (transparency?.fade ?? 0) + (transparency?.seeThrough ?? 0) > 0 && (
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
            className="px-3 py-2.5 md:py-0 text-xs font-medium rounded-2xl text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            Sign In
          </button>
        ) : null}
        {cartSheetState === "changed" ? (
          <div ref={cartMenuRef} className="relative inline-flex">
            <button
              onClick={onAddGangSheetToCart}
              disabled={cartActionBusy}
              title="You've changed this sheet since adding it. Put this version in your cart (C)"
              className="inline-flex items-center justify-center gap-1.5 min-h-10 sm:min-h-0 px-2.5 sm:px-3 py-1.5 sm:py-0 text-xs font-semibold rounded-l-2xl border border-black bg-black text-white hover:bg-gray-900 cursor-pointer disabled:opacity-60 sm:self-stretch"
            >
              <MdSync className="w-4 h-4 sm:hidden" />
              <span className="hidden sm:inline">Update Cart</span>
            </button>
            <button
              onClick={() => setCartMenuOpen((open) => !open)}
              disabled={cartActionBusy}
              aria-label="More cart options"
              aria-haspopup="menu"
              aria-expanded={cartMenuOpen}
              className="inline-flex items-center justify-center min-h-10 sm:min-h-0 px-1.5 rounded-r-2xl border border-l-0 border-black bg-black text-white hover:bg-gray-900 cursor-pointer disabled:opacity-60 sm:self-stretch"
            >
              <MdExpandMore className="w-4 h-4" />
            </button>
            {cartMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-[9999] mt-2 w-64 rounded-xl border border-gray-200 bg-white p-1.5 text-left shadow-lg"
              >
                <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-4 text-gray-500">
                  Your cart still has this sheet as you added it.
                </p>
                <button
                  role="menuitem"
                  onClick={() => {
                    setCartMenuOpen(false);
                    onAddGangSheetToCart?.();
                  }}
                  className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-gray-50"
                >
                  <span className="block text-[13px] font-semibold text-gray-900">Update cart</span>
                  <span className="block text-[11px] leading-4 text-gray-500">Order the sheet as it is now.</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setCartMenuOpen(false);
                    onSaveAsNewSheet?.();
                  }}
                  className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-gray-50"
                >
                  <span className="block text-[13px] font-semibold text-gray-900">Save as a new sheet</span>
                  <span className="block text-[11px] leading-4 text-gray-500">
                    Keep these changes as a separate sheet. The one in your cart stays as it was.
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        ) : (
        <button
          onClick={onAddGangSheetToCart}
          disabled={canAddGangSheetToCart === false}
          title={
            canAddGangSheetToCart === false
              ? "Add items to the artboard before adding to cart"
              : cartSheetState === "current"
              ? "This sheet is in your cart — open the cart (C)"
              : "Add current gangsheet to cart (C)"
          }
          className={`inline-flex items-center justify-center gap-1.5 min-w-10 min-h-10 sm:min-w-0 sm:min-h-0 px-2 sm:px-3 py-1.5 sm:py-0 text-xs font-medium rounded-2xl border transition-colors ${
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
        )}

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
          onMouseEnter={canHover ? onMenuClick : undefined}
          className="p-2 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer w-10 h-10 flex items-center justify-center"
          aria-label="Open menu"
        >
          <MdMenu size={24} />
        </button>
      </div>
      </div>

      <div className="flex md:hidden h-11 items-center gap-2 border-t border-gray-100 text-[11px] text-gray-800">
        {info?.hasItem && (
          <>
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className={`inline-flex h-10 w-10 items-center justify-center rounded ${canUndo ? "active:bg-gray-100" : "opacity-40 pointer-events-none"}`}
              aria-label="Undo"
            >
              <MdUndo className="h-5 w-5" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className={`inline-flex h-10 w-10 items-center justify-center rounded ${canRedo ? "active:bg-gray-100" : "opacity-40 pointer-events-none"}`}
              aria-label="Redo"
            >
              <MdRedo className="h-5 w-5" />
            </button>
          </>
        )}
        {nameControl("flex-1")}
        <UploadIssueChip count={notUploadedCount} onGoTo={onGoToIssue ? () => onGoToIssue("upload") : undefined} compact />
        <DpiStatusChip
          lowDpiCount={info?.lowDpiCount ?? 0}
          unknownDpiCount={info?.unknownDpiCount ?? 0}
          onGoTo={onGoToIssue ? () => onGoToIssue("dpi") : undefined}
          compact
        />
        <TransparencyChip
          fadeCount={transparency?.fade ?? 0}
          seeThroughCount={transparency?.seeThrough ?? 0}
          onGoTo={onGoToIssue ? () => onGoToIssue("transparency") : undefined}
          compact
        />
        <SaveStateChip
          quiet={notUploadedCount + (info?.lowDpiCount ?? 0) + (info?.unknownDpiCount ?? 0) + (transparency?.fade ?? 0) + (transparency?.seeThrough ?? 0) > 0}
          state={saveState}
          isSheetSaved={isSheetSaved}
          onRetry={onRetrySave}
          onSignIn={onSignInClick}
          errorMessage={saveErrorMessage}
        />
        <span
          className="shrink-0 font-semibold tabular-nums"
          title={`${(info?.widthIn ?? 0).toFixed(2)}in wide x ${(info?.heightIn ?? 0).toFixed(2)}in long`}
        >
          ${(info?.price ?? 0).toFixed(2)}
        </span>
        <span className="shrink-0 text-gray-500 tabular-nums">
          {(info?.heightIn ?? 0).toFixed(0)}in
          {info?.atMinimumLength && <span className="ml-0.5 text-[9px] text-gray-400">min</span>}
        </span>
      </div>
    </header>
  );
}
