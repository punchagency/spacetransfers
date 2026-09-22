import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ErrorBoundary } from "./common/ErrorBoundary";
import toast from "react-hot-toast";
import Header from "./Header";
import Artboard from "./Artboard";
import Sidebar from "./Sidebar";
import SaveGangSheetModal from "./modals/SaveGangSheetModal";
import LoadGangSheetModal from "./modals/LoadGangSheetModal";
import AccountSettingsModal from "./modals/AccountSettingsModal";
import AuthModal from "./modals/AuthModal";
import OrderHistoryModal from "./modals/OrderHistoryModal";
import OrderDetailsModal from "./modals/OrderDetailsModal";
import CheckoutModal from "./modals/CheckoutModal";
import UnsavedChangesModal from "./modals/UnsavedChangesModal";
import ConfirmModal from "./modals/ConfirmModal";
import MobileNoticeModal from "./modals/MobileNoticeModal";
import { useIsMobile } from "../lib/useIsMobile";
import UnderUtilizedSheetModal from "./modals/UnderUtilizedSheetModal";
import { captureArtboard } from "./artboard/lib/utils";
import { apiFetch } from "../lib/utils/api";
import { clearAuth, getToken, onAuthChanged } from "../lib/utils/auth";
import { showCartAddedToast } from "./common/CartAddedToast";
import { getGangsheetSnapshot } from "../lib/utils/gangsheetState";
import { isTypingTarget } from "../lib/utils/keyboard";
import { artworkNotUploaded, nextCopyName, nextUntitledName, UNTITLED_SHEET } from "../lib/utils/sheetSaving";
import { stripEmbeddedData } from "../lib/utils/assetIdentity";
import { stripEmbeddedImages } from "../lib/utils/payloadImages";
import { CANVAS, PRICING } from "../config/artboard.config";
import {
  DEFAULT_SHEET_SETTINGS,
  loadEditorSettings,
  saveEditorSettings,
  sheetSettingsForSave,
  sheetSettingsFromSaved,
  type EditorSettings,
} from "../lib/utils/editorSettings";
import { getSheetWidthIn, getMinSheetLengthIn, usePricingSettings, billableSheetDimensions, getPricePerSqFt } from "../lib/utils/pricingRates";
import { cartLineKey, cartSignInMessage, mergeCarts, readCartOwner, repriceCart, writeCartOwner } from "../lib/utils/cartSync";
import { computeRenderCopies, sheetContentLengthIn } from "./artboard/lib/utils/layoutHelpers";

type SaveOptions = { title?: string; thumbnail?: string };
type SaveResult = {
  ok: boolean;
  reason?: string;
  /** The saved sheet and its name, so a caller acting on it (add to cart) uses what was just saved. */
  designId?: string;
  title?: string;
};

export default function Editor() {
  const pricingSettings = usePricingSettings();
  const { pricePerSqFt } = pricingSettings;
  // Phone detection drives both the one-time notice and the hiding of tools
  // that can't be operated smoothly on a small touch screen (see below).
  const isMobile = useIsMobile();

  // Mobile-only notice: show once per device on phones, unless the user opted
  // out with "Don't show this again". Tablets and desktops never see it.
  const [showMobileNotice, setShowMobileNotice] = useState(false);
  useEffect(() => {
    if (!isMobile) return;
    let dismissedForever = false;
    try {
      dismissedForever = localStorage.getItem("hideMobileNotice") === "1";
    } catch {}
    if (!dismissedForever) setShowMobileNotice(true);
  }, [isMobile]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [isSubAccountCreation, setIsSubAccountCreation] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState<string | null>(null);
  const [showOrderHistoryModal, setShowOrderHistoryModal] = useState(false);
  const [showOrderDetailsModal, setShowOrderDetailsModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [historyState, setHistoryState] = useState<{
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
  }>({ undo: () => {}, redo: () => {}, canUndo: false, canRedo: false });
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  /*
   * One sign-out. This was written out twice, identically, in two different
   * menus — so a change to how a session ends had to be remembered in both.
   */
  const signOut = useCallback((message = "Successfully signed out") => {
    setIsLoggedIn(false);
    setUser(null);
    clearAuth();
    // The account keeps its cart; this browser should not show it to whoever
    // uses it next. (A session that only expired keeps it — see cartSync.ts.)
    setCartItems([]);
    writeCartOwner(null);
    if (message) toast.success(message);
  }, []);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("resetToken");
      const email = params.get("email");
      if (token) {
        setResetToken(token);
        setResetEmail(email);
        setAuthView("login");
        setIsSubAccountCreation(false);
        setShowAuthModal(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    apiFetch("/auth/me")
      .then((userData) => {
        /*
         * Only customer accounts belong in the store. A session of another kind
         * — a token from the printer or admin app, or one minted before this
         * check existed — could work the board but never save it, since every
         * `/customer/*` route refuses it.
         */
        if (String(userData?.role || "").toUpperCase() !== "CUSTOMER") {
          clearAuth();
          setIsLoggedIn(false);
          setUser(null);
          toast.error(
            "That's not a customer account. Printers and admins have their own apps — sign in with your customer account to build gang sheets.",
          );
          return;
        }
        setUser(userData);
        setIsLoggedIn(true);
      })
      .catch(() => {
        // `apiFetch` has already cleared the token on a 401; this just brings
        // the UI into line with it.
        setIsLoggedIn(false);
        setUser(null);
      });
  }, []);

  /*
   * The session ending mid-flight — an expired or revoked token — used to leave
   * the header showing a signed-in user while every request failed. `apiFetch`
   * clears the token on a 401 and announces it; this is what listens.
   *
   * It also covers signing out in another tab.
   */
  useEffect(
    () =>
      onAuthChanged(() => {
        if (getToken()) return;
        setIsLoggedIn((wasLoggedIn) => {
          if (wasLoggedIn) toast.error("Your session has expired. Please sign in again.");
          return false;
        });
        setUser(null);
      }),
    [],
  );

  useEffect(() => {
    if (!isLoggedIn || !user?.id) {
      prevUserIdRef.current = null;
      return;
    }

    if (prevUserIdRef.current && prevUserIdRef.current !== user.id) {
      setArtboardData({ items: [], counter: Date.now() });
      setLoadedDesignData({ items: [], counter: Date.now() });
      setCurrentLoadedDesignId(null);
      setCurrentLoadedDesignString(null);
      setCurrentLoadedDesignTitle(null);
      setSavedDesigns([]);
      setLastAction(null);
      setDeletedItems({});
      setCartWarning(null);
      setShowLoadModal(false);
      setShowSaveModal(false);
    }

    prevUserIdRef.current = user.id;
  }, [isLoggedIn, user?.id]);
  const [cartItems, setCartItems] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem("cart");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const cartItemsRef = useRef(cartItems);
  cartItemsRef.current = cartItems;
  /** The account whose saved cart has been read this session; nothing is written to an account before that. */
  const [cartLoadedFor, setCartLoadedFor] = useState<string | null>(null);

  /*
   * Signing in loads the account's saved cart. See cartSync.ts for the rules.
   *
   * Until this succeeds the account's cart is never written: the sync below used
   * to fire on mount, so opening the store on a new device replaced the saved
   * cart with that browser's empty one. If the read fails it is not retried
   * until the next sign-in or reload, and the saved cart is left untouched.
   */
  const isCustomer = isLoggedIn && Boolean(user?.id) && user?.role === "CUSTOMER";
  useEffect(() => {
    if (!isCustomer) {
      setCartLoadedFor(null);
      return;
    }
    const userId = String(user.id);
    if (cartLoadedFor === userId) return;

    let cancelled = false;
    apiFetch("/customer/cart")
      .then((res: any) => {
        if (cancelled) return;
        const saved = Array.isArray(res?.cart) ? res.cart : [];
        const owner = readCartOwner();
        // A cart another account left in this browser is theirs, not a guest cart.
        const browserCart = owner && owner !== userId ? [] : cartItemsRef.current;
        const merged = mergeCarts(saved, browserCart);
        const browserKeys = new Set(browserCart.map(cartLineKey));
        const savedKeys = new Set(saved.map(cartLineKey));
        const restored = saved.filter((line: any) => !browserKeys.has(cartLineKey(line))).length;
        /*
         * Items added while signed out. Nothing ties a signed-out cart to a
         * person, so they join whichever account signs in here — said out loud,
         * so someone signing in on a shared computer notices items that are not
         * theirs. Only for a genuine guest cart: this account's own lines that
         * had not synced yet are not news.
         */
        const addedAsGuest = owner ? 0 : browserCart.filter((line: any) => !savedKeys.has(cartLineKey(line))).length;

        setCartItems(merged);
        writeCartOwner(userId);
        setCartLoadedFor(userId);
        const message = cartSignInMessage(restored, addedAsGuest);
        if (message) toast.success(message);
      })
      .catch(() => {
        // Leave the saved cart alone rather than risk overwriting it.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCustomer, user?.id, cartLoadedFor]);

  /*
   * Cart lines follow the admin's pricing, like the board does. A line kept its
   * price from when it was added, while checkout charges today's — so after a
   * rate or minimum-length change the cart showed one total and the card was
   * charged another. Waits for the real settings; the compiled fallbacks must
   * not rewrite anything.
   */
  useEffect(() => {
    if (!pricingSettings.loaded) return;
    setCartItems((prev) => repriceCart(prev));
  }, [pricingSettings, cartItems]);

  useEffect(() => {
    /**
     * Persist the cart without its artwork.
     *
     * Stripping happens *before* the write, not as a retry after one fails.
     * The old order assumed the failure mode was a `QuotaExceededError` from
     * localStorage — but `JSON.stringify` runs first, and on a cart holding
     * several base64 images it throws `RangeError: Invalid string length`
     * (V8 caps a string near 512 MB) before localStorage is ever consulted.
     * The fallback that was supposed to save the situation could not run,
     * because the code that would have triggered it never returned.
     *
     * Nothing is lost by stripping unconditionally: a `data:` URL is a local
     * render of an asset the server already holds, and the structural data
     * kept here (items, artboardData, pricing, size) is what the cart needs to
     * restore.
     */
    const writeCart = (payload: any[]) => {
      localStorage.setItem("cart", JSON.stringify(payload));
    };

    try {
      writeCart(stripEmbeddedData(cartItems));
    } catch {
      // Still too large for the quota even without artwork — an unusually large
      // number of rows. Clear it so a stale half-write doesn't break next load.
      try {
        localStorage.removeItem("cart");
      } catch {}
    }

    // Sync to server only for actual customer accounts. Other roles hit a
    // guaranteed 403 from the /customer/* role middleware, which would spam
    // the console on every cart mutation.
    if (isCustomer && cartLoadedFor === String(user.id)) {
      // Materialize before sending. Unlike the localStorage copy — where
      // artwork can simply be dropped and re-fetched — the server cart has to
      // keep working references, so embedded images are uploaded once and
      // replaced by their hosted URLs. Sending them inline instead put the
      // whole board in the request body and returned 413.
      stripEmbeddedImages({ cart: cartItems })
        .then((payload) =>
          apiFetch("/customer/cart", {
            method: "PUT",
            body: JSON.stringify(payload),
          }),
        )
        .catch(() => {
          // Silent — the local cart state is the source of truth for the UI;
          // the server sync is best-effort persistence across devices.
        });
    }
  }, [cartItems, isCustomer, cartLoadedFor, user?.id]);

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) = redo.
  // Skipped while typing in form fields so we don't hijack the browser's native
  // text-editing undo/redo inside inputs and textareas.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        historyState.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        historyState.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyState]);

  /*
   * Single-key shortcuts, alongside the artboard's "N" for auto-nest: "S" opens
   * the settings panel, "C" puts the sheet in the cart (or updates the line it
   * is already on). Ignored while typing, never with a modifier held, and never
   * while a dialog is open — pressing "n" with the cart on screen re-nested the
   * board behind it, which is not what anyone reading a cart means.
   */
  const dialogOpenRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (dialogOpenRef.current || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        setIsSidebarOpen((open) => !open);
      } else if (key === "c") {
        e.preventDefault();
        void addToCartRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const [headerInfo, setHeaderInfo] = useState<{
    hasItem: boolean;
    areaSf?: number;
    widthIn?: number;
    heightIn?: number;
    name?: string;
    price?: number;
    lowDpiCount?: number;
    unknownDpiCount?: number;
    /** How long the artwork actually is, before the minimum length applies. */
    usedHeightIn?: number;
  }>();

  /**
   * "Show me which images the DPI chip is counting."
   *
   * Lives here rather than in `Artboard` because the control and the artwork
   * are in different subtrees — the chip is in `Header`, the items are in
   * `Artboard`, and `Editor` is their only common parent.
   *
   * A plain boolean rather than a nonce: toggling off and on again is what
   * re-runs the scroll-into-view, and that is also the behaviour a customer
   * expects from a button that visibly reads as pressed.
   */
  const [isDpiHighlighting, setIsDpiHighlighting] = useState(false);

  const dpiFlaggedCount =
    (headerInfo?.lowDpiCount ?? 0) + (headerInfo?.unknownDpiCount ?? 0);

  /**
   * Drop the highlight once there is nothing left to highlight.
   *
   * The count falls to zero when the customer enhances the artwork, deletes it,
   * or scales it down — at which point the chip itself unmounts, taking the
   * only control that could switch this off with it. Without this the board
   * would be stuck in a highlight state with no way back.
   */
  useEffect(() => {
    if (dpiFlaggedCount === 0 && isDpiHighlighting) setIsDpiHighlighting(false);
  }, [dpiFlaggedCount, isDpiHighlighting]);

  /**
   * Dismissal: Escape, or a pointer press anywhere outside the chip.
   *
   * `pointerdown` in the capture phase rather than `click`, so the highlight
   * clears the instant the customer starts interacting with the board instead
   * of after they release — otherwise a click that selects an item leaves the
   * highlight up for the length of the gesture.
   *
   * Presses inside the chip are exempt: the chip's own `onClick` owns toggling,
   * and without the exemption this listener would clear the state on the very
   * pointerdown that precedes the click meant to set it.
   */
  useEffect(() => {
    if (!isDpiHighlighting) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-dpi-chip]")) return;
      setIsDpiHighlighting(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDpiHighlighting(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isDpiHighlighting]);
  const [savedDesigns, setSavedDesigns] = useState<
    Array<{
      id: string;
      title: string;
      time: string;
      size: string;
      thumbnail: string;
    }>
  >([]);
  const [artboardData, setArtboardData] = useState<any>(null);
  const [lastAction, setLastAction] = useState<{
    type: string;
    id?: number;
    payload?: any;
  } | null>(null);
  const [deletedItems, setDeletedItems] = useState<Record<number, any>>({});
  const [loadedDesignData, setLoadedDesignData] = useState<any>(null);
  const [cartWarning, setCartWarning] = useState<string | null>(null);
  const [currentLoadedDesignId, setCurrentLoadedDesignId] = useState<string | null>(null);
  const [currentLoadedDesignString, setCurrentLoadedDesignString] = useState<string | null>(null);
  const [currentLoadedDesignTitle, setCurrentLoadedDesignTitle] = useState<string | null>(null);
  /*
   * A name for a board that has not been saved yet.
   *
   * Renaming used to require `currentLoadedDesignId`, because it PATCHes a
   * design record — so a fresh board read "Untitled gang sheet" with no way to
   * name it until after saving, which is backwards from how every document
   * editor works. This holds the name until there is something to attach it to,
   * and seeds the save dialog when there is.
   */
  const [draftDesignTitle, setDraftDesignTitle] = useState<string | null>(null);
  const prevUserIdRef = useRef<string | null>(null);

  const ensureUniqueItemIds = (items: any[]) => {
    const list = Array.isArray(items) ? items : [];
    const seen = new Set<number>();
    let nextId =
      list.reduce((m: number, it: any) => Math.max(m, Number(it?.id) || 0), 0) +
      1;

    return list.map((it: any) => {
      const raw = Number(it?.id);
      let id = Number.isFinite(raw) ? raw : nextId++;

      if (seen.has(id)) {
        while (seen.has(nextId)) nextId++;
        id = nextId++;
      }

      seen.add(id);

      if (it?.id === id) return it;
      return { ...it, id };
    });
  };

  const updateSavedDesignSnapshot = (designId: string, patch: Partial<{
    title: string;
    thumbnail: string;
    time: string;
  }>) => {
    setSavedDesigns((prev) =>
      prev.map((d) => (d.id === designId ? { ...d, ...patch } : d)),
    );
  };

  const [baselineSnapshot, setBaselineSnapshot] = useState<string>(() =>
    getGangsheetSnapshot([]),
  );

  const getCurrentItems = () => {
    const artItems = Array.isArray(artboardData?.items) ? artboardData.items : null;
    if (artItems) return artItems;
    const loadedItems = Array.isArray(loadedDesignData?.items) ? loadedDesignData.items : [];
    return loadedItems;
  };

  // Memoized on the item lists themselves. This ran on *every* render before —
  // including renders caused by typing in an unrelated field — so the board was
  // re-serialized continuously rather than when it actually changed.
  const currentSnapshot = useMemo(
    () => getGangsheetSnapshot(getCurrentItems()),
    [artboardData?.items, loadedDesignData?.items],
  );
  const hasUnsavedChanges = currentSnapshot !== baselineSnapshot;

  /**
   * The cart line this board was added as.
   *
   * Without it, carrying on designing after adding to the cart and pressing Add
   * again put a second, near-identical sheet in the cart — or, when nothing had
   * changed, was refused with "this exact gang sheet is already in your cart"
   * and no way forward. The board now knows its line: more edits update it, and
   * "Start a new sheet" is what makes the next add a separate one.
   */
  const [cartLineId, setCartLineId] = useState<number | null>(null);
  const cartLine = cartItems.find((line) => line.id === cartLineId) ?? null;
  /** Whether this board is in the cart. */
  const cartSheetState: "none" | "current" = cartLine ? "current" : "none";
  /** The sheet's name as shown in the header, the cart and the saved list. */
  const sheetTitle = currentLoadedDesignTitle || draftDesignTitle || UNTITLED_SHEET;
  /**
   * Whether changes on the board flow into its cart line.
   *
   * They used to, always, a moment after each edit. But changing a sheet that
   * is already in the cart is ambiguous: the customer may be refining that
   * order, or starting a variation of it. So on the first change they are
   * asked; "Update the cart" sets this and the cart follows from then on.
   * Opening a sheet with the cart's Edit sheet is already that answer.
   */
  const [cartFollowLineId, setCartFollowLineId] = useState<number | null>(null);
  const followsCart = Boolean(cartLine) && cartFollowLineId === cartLine?.id;
  /**
   * An in-cart sheet has changed and the customer hasn't said what the change
   * is for. Until they do, neither the cart line nor the saved sheet behind it
   * is overwritten — so the version in the cart can't change under them.
   */
  const cartDecisionPending = Boolean(cartLine) && !followsCart && cartLine!.designSignature !== currentSnapshot;
  const CART_DECISION_FIRST =
    "This sheet is in your cart — choose Update cart or Save as a new sheet first.";

  const [isGangsheetBusy, setIsGangsheetBusy] = useState(false);
  const pendingAfterSaveRef = useRef<null | (() => Promise<void> | void)>(null);
  const [unsavedPrompt, setUnsavedPrompt] = useState<null | {
    title: string;
    message: string;
    primaryLabel: string;
    secondaryLabel: string;
  }>(null);
  const [showClearArtboardConfirm, setShowClearArtboardConfirm] = useState(false);
  const [showUnderUtilizedCartConfirm, setShowUnderUtilizedCartConfirm] = useState(false);
  const [underUtilizedMeta, setUnderUtilizedMeta] = useState<{
    billedPrice: number;
    usedLengthIn: number;
    minLengthIn: number;
    sheetWidthIn: number;
  } | null>(null);

  const clearWorkspace = () => {
    setCartLineId(null);
    // A fresh board has nothing saved yet; the chip must not still say "Saved".
    setSaveState("idle");
    setSaveError(null);
    setArtboardData({ items: [], counter: Date.now() });
    setLoadedDesignData({ items: [], counter: Date.now() });
    setCurrentLoadedDesignId(null);
    setCurrentLoadedDesignString(null);
    setCurrentLoadedDesignTitle(null);
    setLastAction(null);
    setDeletedItems({});
    setBaselineSnapshot(getGangsheetSnapshot([]));
    // A new sheet starts from the defaults. View settings are the customer's
    // and carry over; spacing, margin and auto-nest belong to the sheet.
    setSettings((prev) => ({ ...prev, ...DEFAULT_SHEET_SETTINGS }));
  };

  const mapItemsForSave = (items: any[]) => {
    const normalizedItems = ensureUniqueItemIds(items);
    const mappedItems = normalizedItems.map((it: any) => ({
      id: it.id,
      assetId: it.assetId || it.originalUrl || it.url,
      /*
       * The image the piece shows and prints, cropped or not. It used to be
       * dropped whenever auto-crop was off, so an uncropped piece reopened as
       * its original upload — losing any background removal or AI edit — and
       * was sent to print as the asset's trimmed copy, not the image laid out.
       */
      croppedUrl:
        typeof it.croppedUrl === "string" && it.croppedUrl
          ? it.croppedUrl
          : typeof it.url === "string" && !it.url.startsWith("data:")
          ? it.url
          : undefined,
      // The auto-crop switch's source, when an edit has replaced the upload.
      uncroppedUrl:
        typeof it.uncroppedUrl === "string" && it.uncroppedUrl && it.uncroppedUrl !== it.originalUrl
          ? it.uncroppedUrl
          : undefined,
      // Pixel dimensions of the croppedUrl source. Required for canvas-processed items
      // (canvas crop, BG removal) so the server calculates DPI from the actual source
      // pixel count instead of the DB's original widthPx, preventing upscaling.
      croppedWidthPx: it.croppedWidthPx || undefined,
      croppedHeightPx: it.croppedHeightPx || undefined,
      // So a reopened sheet knows each piece's resolution without waiting for
      // the image to download (the DPI check counted it "unknown" till then).
      nativeWidthPx: typeof it.nativeWidthPx === "number" && it.nativeWidthPx > 0 ? it.nativeWidthPx : undefined,
      widthIn: it.widthIn,
      heightIn: it.heightIn,
      posX: it.posX,
      posY: it.posY,
      rotation: it.rotation || 0,
      copies: it.copies || 1,
      linked: Boolean(it.linked),
      autoCrop: it.autoCrop !== false,
      // Everything needed to reopen the design exactly as it was laid out.
      flipped: Boolean(it.flipped),
      nestRotation: it.nestRotation === 90 ? 90 : 0,
      flowCols: typeof it.flowCols === "number" && it.flowCols >= 1 ? it.flowCols : undefined,
      pinned: Boolean(it.pinned),
      locked: Boolean(it.locked),
      // Pieces bundled to act as one reopen as a group.
      groupId: typeof it.groupId === "string" && it.groupId ? it.groupId : undefined,
    }));
    return { normalizedItems, mappedItems };
  };

  /**
   * Autosave.
   *
   * A gang sheet takes a while to build, and losing it to a closed tab is the
   * worst thing this editor can do. Saving was a button in the sidebar, so a
   * board was unsaved by default and every clear or load had to interrupt with
   * "save first?". The board is now saved on its own a couple of seconds after
   * it stops changing, and `saveState` says so in the header — which is also
   * what makes "start a new sheet" a safe, one-press action.
   *
   * Signed-in customers only: a design belongs to an account. Guests keep the
   * old prompt before anything would discard their work.
   */
  const AUTOSAVE_DELAY_MS = 2000;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveRef = useRef<(options?: SaveOptions) => Promise<SaveResult>>(async () => ({ ok: false }));

  const canAutosave = isLoggedIn && user?.role === "CUSTOMER";

  const ARTWORK_PENDING_MESSAGE =
    "Your artwork hasn't finished uploading yet, so this sheet can't be saved. Check your connection and try again in a moment.";

  /**
   * The one place a sheet is written to the account — autosave, the Save button
   * and adding to cart all come through here, so they cannot disagree about what
   * "saved" means.
   */
  const saveBoardNow = async (options: SaveOptions = {}): Promise<SaveResult> => {
    const items = getCurrentItems();
    if (!canAutosave) {
      return {
        ok: false,
        reason: isLoggedIn
          ? "Gang sheets are saved to customer accounts. Sign in with your customer account to save this one."
          : "Sign in to save your gang sheets.",
      };
    }
    if (items.length === 0) return { ok: false, reason: "There is nothing on the sheet to save." };
    // Saving now would overwrite the sheet that is in the cart before the
    // customer has said whether these changes belong to it.
    if (cartDecisionPending) return { ok: false, reason: CART_DECISION_FIRST };
    if (artworkNotUploaded(items)) {
      setSaveState("error");
      setSaveError(ARTWORK_PENDING_MESSAGE);
      return { ok: false, reason: ARTWORK_PENDING_MESSAGE };
    }

    const { normalizedItems, mappedItems } = mapItemsForSave(items);
    const snapshot = getGangsheetSnapshot(normalizedItems);
    let savedId: string | undefined;
    let savedTitle: string | undefined;
    setSaveState("saving");
    try {
      // Artwork the editor rendered locally is uploaded once and referenced by
      // URL; sending it inline puts the whole board in the request body.
      const { items: payloadItems } = await stripEmbeddedImages({ items: mappedItems });
      const artboardData = { items: payloadItems, ...sheetSettingsForSave(settings) };

      if (currentLoadedDesignId) {
        await apiFetch(`/customer/designs/${currentLoadedDesignId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
            ...(options.title ? { title: options.title } : {}),
            artboardData,
          }),
        });
        if (options.title) setCurrentLoadedDesignTitle(options.title);
        savedId = currentLoadedDesignId;
        savedTitle = options.title || currentLoadedDesignTitle || draftDesignTitle || undefined;
        updateSavedDesignSnapshot(currentLoadedDesignId, {
          ...(options.title ? { title: options.title } : {}),
          ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
          time: formatDesignTime(new Date().toISOString()),
        });
      } else {
        const title = (
          options.title ||
          draftDesignTitle ||
          nextUntitledName(savedDesigns.map((d: any) => d?.title))
        ).trim();
        const thumbnail = options.thumbnail ?? (await captureArtboard().catch(() => undefined));
        const created = await apiFetch("/customer/designs", {
          method: "POST",
          body: JSON.stringify({
            title,
            thumbnail,
            size: {
              widthIn: headerInfo?.widthIn || getSheetWidthIn(),
              heightIn: headerInfo?.heightIn || getMinSheetLengthIn(),
            },
            pricing: { areaSqFt: headerInfo?.areaSf ?? 0, price: headerInfo?.price ?? 0 },
            artboardData,
          }),
        });
        const createdId = created?.id ? String(created.id) : null;
        if (createdId) {
          setCurrentLoadedDesignId(createdId);
          setCurrentLoadedDesignTitle(title);
          setDraftDesignTitle(null);
          savedId = createdId;
        }
        savedTitle = title;
      }
      fetchDesigns();
      setBaselineSnapshot(snapshot);
      setCurrentLoadedDesignString(snapshot);
      setSaveState("saved");
      setSaveError(null);
      return { ok: true, designId: savedId, title: savedTitle };
    } catch (err: any) {
      const reason = err?.message || "This sheet could not be saved.";
      setSaveState("error");
      setSaveError(reason);
      return { ok: false, reason };
    }
  };
  saveRef.current = saveBoardNow;

  useEffect(() => {
    // Waits while the customer decides whether changes to an in-cart sheet
    // update the cart or become a new sheet — see `cartDecisionPending`.
    if (!canAutosave || !hasUnsavedChanges || cartDecisionPending) return;
    const timer = setTimeout(() => {
      void saveRef.current();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentSnapshot, canAutosave, hasUnsavedChanges, cartDecisionPending]);

  /** The sidebar's Save for a sheet that already has a record. */
  const saveLoadedGangsheet = async () => {
    if (!currentLoadedDesignId) return false;
    if (!isLoggedIn) {
      toast.error("Please sign in to save");
      setAuthView("login");
      setShowAuthModal(true);
      return false;
    }
    setIsGangsheetBusy(true);
    const toastId = toast.loading("Saving gangsheet...");
    try {
      const thumbnail = await captureArtboard().catch(() => undefined);
      const result = await saveRef.current({ thumbnail });
      if (result.ok) {
        toast.success("Gangsheet saved", { id: toastId });
        return true;
      }
      toast.error(result.reason || "Failed to save gangsheet", { id: toastId });
      return false;
    } finally {
      setIsGangsheetBusy(false);
    }
  };

  const loadGangsheetById = async (id: string) => {
    setIsGangsheetBusy(true);
    const toastId = toast.loading("Loading gangsheet...");
    try {
      const res = await apiFetch(`/customer/designs/${id}`);
      const items = Array.isArray(res?.artboardData?.items) ? res.artboardData.items : [];

      const cropImage = async (url: string) => {
        try {
          const trimmed = await apiFetch("/customer/assets/trim", {
            method: "POST",
            body: JSON.stringify({ url }),
            timeoutMs: 90_000,
          });
          if (trimmed?.trimmedUrl) return trimmed.trimmedUrl as string;
        } catch {
        }

        return url;
      };

      const mappedItems = ensureUniqueItemIds(
        await Promise.all(
          items.map(async (it: any) => {
            /*
             * `assetId` is usually the asset's database id, not an address — the
             * server sends the address alongside as `assetUrl`. Using the id as
             * the image showed a broken image for any piece that had to fall
             * back to it.
             */
            const originalUrl =
              typeof it.assetUrl === "string" && it.assetUrl
                ? it.assetUrl
                : /^(https?:|data:|\/)/.test(String(it.assetId || ""))
                ? it.assetId
                : undefined;
            const autoCrop = it.autoCrop !== false;
            const savedCroppedUrl =
              typeof it.croppedUrl === "string" && it.croppedUrl ? it.croppedUrl : null;
            const uncroppedUrl =
              typeof it.uncroppedUrl === "string" && it.uncroppedUrl ? it.uncroppedUrl : originalUrl;
            const url =
              savedCroppedUrl ||
              (autoCrop && uncroppedUrl ? await cropImage(uncroppedUrl) : uncroppedUrl) ||
              "";
            return {
              id: it.id,
              assetId: it.assetId,
              url,
              // Restore croppedUrl so subsequent saves don't lose the export source.
              // Without this, re-saving a loaded design loses the data URL for
              // canvas-processed items, causing the server to fall back to the wrong source.
              croppedUrl: savedCroppedUrl || undefined,
              // Restore pixel dimensions of the canvas export source so the server DPI
              // calculator uses the correct pixel count on re-save or checkout.
              croppedWidthPx: typeof it.croppedWidthPx === "number" && it.croppedWidthPx > 0 ? it.croppedWidthPx : undefined,
              croppedHeightPx: typeof it.croppedHeightPx === "number" && it.croppedHeightPx > 0 ? it.croppedHeightPx : undefined,
              nativeWidthPx: typeof it.nativeWidthPx === "number" && it.nativeWidthPx > 0 ? it.nativeWidthPx : undefined,
              rotation: it.rotation || 0,
              // Restored rather than reset: a locked or mirrored piece used to
              // reopen unlocked and unmirrored.
              locked: Boolean(it.locked),
              expanded: false,
              flipped: Boolean(it.flipped),
              autoCrop,
              copies: it.copies || 1,
              widthIn: it.widthIn,
              heightIn: it.heightIn,
              posX: it.posX,
              posY: it.posY,
              nestRotation: it.nestRotation === 90 ? 90 : 0,
              flowCols: typeof it.flowCols === "number" && it.flowCols >= 1 ? it.flowCols : undefined,
              pinned: Boolean(it.pinned),
              linked: Boolean(it.linked),
              groupId: typeof it.groupId === "string" && it.groupId ? it.groupId : undefined,
              price: 0,
              originalUrl,
              uncroppedUrl,
            };
          }),
        ),
      );

      // The design's own spacing, margin and auto-nest, applied in the same
      // render as its items so it lays out exactly as it was saved.
      const savedSheet = sheetSettingsFromSaved(res?.artboardData);
      setSettings((prev) => ({ ...prev, ...savedSheet }));

      const nextSnapshot = getGangsheetSnapshot(mappedItems);
      setLoadedDesignData({ items: mappedItems, counter: Date.now() });
      setArtboardData({ items: mappedItems, counter: Date.now() });
      // A different sheet is on the board now, so it is not the cart's line.
      setCartLineId(null);
      setCurrentLoadedDesignId(id);
      setCurrentLoadedDesignString(nextSnapshot);
      setBaselineSnapshot(nextSnapshot);
      setCurrentLoadedDesignTitle(res?.title || null);
      setLastAction(null);
      setDeletedItems({});
      toast.success("Gangsheet loaded", { id: toastId });

      /*
       * Say when artwork cannot be fetched, instead of leaving the board to
       * report it as unknown DPI. Designs saved before artwork was required to
       * be uploaded can reference images that exist nowhere any more, and
       * "0 DPI" is not an explanation anyone can act on.
       *
       * Two things this check used to get wrong, both seen on a real sheet:
       *  - It loaded each image without CORS. The browser cached that copy, and
       *    every later CORS read of the image (its pixel size, its transparency)
       *    was served the cached copy and failed — so a perfectly good sheet
       *    showed broken images and "unknown DPI" on every piece.
       *  - It gave up after 15 seconds and called the image missing. A large
       *    print file can take longer than that to download, so existing
       *    artwork was reported as needing to be re-added. Only an actual load
       *    error counts now; slow is not missing.
       */
      void (async () => {
        const urls = Array.from(
          new Set(mappedItems.map((it: any) => String(it.url || "")).filter(Boolean)),
        );
        const loadable = await Promise.all(
          urls.map(
            (url) =>
              new Promise<boolean>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => resolve(true);
                img.onerror = () => resolve(false);
                img.src = url;
              }),
          ),
        );
        const missing = loadable.filter((ok) => !ok).length;
        if (missing > 0) {
          toast.error(
            `${missing} ${missing === 1 ? "image" : "images"} in this gang sheet could not be loaded. ` +
              "It was saved before its artwork finished uploading — re-add the artwork to print it.",
            { id: "design-missing-art", duration: 9000 },
          );
        }
      })();
    } catch (err: any) {
      toast.error(err?.message || "Failed to load gangsheet", { id: toastId });
    } finally {
      setIsGangsheetBusy(false);
    }
  };

  const openUnsavedPrompt = (prompt: NonNullable<typeof unsavedPrompt>, after: () => Promise<void> | void) => {
    pendingAfterSaveRef.current = after;
    setUnsavedPrompt(prompt);
  };

  const handleDiscardAndContinue = async () => {
    const action = pendingAfterSaveRef.current;
    setUnsavedPrompt(null);
    if (action) await action();
    pendingAfterSaveRef.current = null;
  };

  const handleSaveAndContinue = async () => {
    const action = pendingAfterSaveRef.current;
    setUnsavedPrompt(null);
    if (!action) return;

    if (currentLoadedDesignId) {
      const ok = await saveLoadedGangsheet();
      if (ok) await action();
      pendingAfterSaveRef.current = null;
      return;
    }

    setShowSaveModal(true);
  };

  const cancelPendingAction = () => {
    setUnsavedPrompt(null);
    pendingAfterSaveRef.current = null;
  };

  /**
   * Runs `proceed` once the board on screen is safe to leave.
   *
   * With autosave on there is nothing to ask: the last changes are written and
   * the sheet is waiting under "Load gang sheet". Only a guest — who has no
   * account to save to — still gets the choice, which is the one case where the
   * work really would be lost.
   */
  const leaveBoard = async (
    prompt: NonNullable<typeof unsavedPrompt>,
    proceed: () => void | Promise<void>,
  ) => {
    if (!hasUnsavedChanges) return void (await proceed());
    if (canAutosave) {
      const result = await saveRef.current();
      if (result.ok) {
        toast.success(`Saved “${currentLoadedDesignTitle || draftDesignTitle || "gang sheet"}”`, { id: "board-saved" });
        return void (await proceed());
      }
      // Could not be saved — never discard the board silently over it.
      openUnsavedPrompt({ ...prompt, message: `${result.reason ?? ""} ${prompt.message}`.trim() }, proceed);
      return;
    }
    openUnsavedPrompt(prompt, proceed);
  };

  const attemptCreateNewGangsheet = () => {
    void leaveBoard(
      {
        title: "Unsaved Changes",
        message: "You have unsaved changes. Do you want to save before creating a new gangsheet?",
        primaryLabel: "Save & Create New",
        secondaryLabel: "Discard & Create New",
      },
      clearWorkspace,
    );
  };

  const attemptLoadGangsheet = (id: string) => {
    void leaveBoard(
      {
        title: "Unsaved Changes",
        message: "You have unsaved changes. Do you want to save before loading?",
        primaryLabel: "Save & Load",
        secondaryLabel: "Discard & Load",
      },
      () => loadGangsheetById(id),
    );
  };

  const attemptClearArtboard = () => {
    void leaveBoard(
      {
        title: "Unsaved Changes",
        message: "You have unsaved changes. Do you want to save before clearing the artboard?",
        primaryLabel: "Save & Clear",
        secondaryLabel: "Discard & Clear",
      },
      () => setShowClearArtboardConfirm(true),
    );
  };

  const hasAnyItems =
    (Array.isArray(artboardData?.items) && artboardData.items.length > 0) ||
    (Array.isArray(loadedDesignData?.items) && loadedDesignData.items.length > 0);

  useEffect(() => {
    const shouldWarn = hasUnsavedChanges;
    const handler = (e: BeforeUnloadEvent) => {
      if (!shouldWarn) return;
      e.preventDefault();
      e.returnValue = "Refreshing or leaving may clear your current gangsheet. Save your design before leaving.";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  const formatDesignTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  };

  const fetchDesigns = async (searchQuery?: string) => {
    if (!isLoggedIn) return;
    try {
      const endpoint = searchQuery
        ? `/customer/designs/search?q=${encodeURIComponent(searchQuery)}`
        : "/customer/designs";
      const res = await apiFetch(endpoint);
      const designs = Array.isArray(res?.designs) ? res.designs : [];
      setSavedDesigns(
        designs.map((d: any) => ({
          id: String(d.id),
          title: d.title,
          time: formatDesignTime(d.updatedAt || d.createdAt),
          size: d.size,
          thumbnail: d.thumbnail,
        }))
      );
    } catch {
    }
  };

  // Settings State lifted from Sidebar
  const [settings, setSettings] = useState(loadEditorSettings);

  /*
   * Every setting persists, not just the background.
   *
   * `canvasBg` was written to localStorage and the other seven were not, so
   * turning off rulers or setting a spacing lasted until the next reload and
   * then silently reverted. That reads as the control not working. One of eight
   * persisting was an oversight rather than a decision.
   */
  const updateSetting = (key: keyof EditorSettings, value: any) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveEditorSettings(next);
      return next;
    });
  };

  const addGangSheetToCartNow = async (fromUnusedSpacePrompt: boolean = false) => {
    if (!isLoggedIn) {
      setAuthView("register");
      setShowAuthModal(true);
      return;
    }
    // Adding now would save over the sheet already in the cart, and add a
    // second line, before the customer has said which they meant.
    if (cartDecisionPending) {
      toast(CART_DECISION_FIRST, { id: "cart-decision", icon: "🛒" });
      return;
    }

    try {
      const currentItems = getCurrentItems();
      if (!currentItems || currentItems.length === 0) {
        const msg = "Add items to the artboard before adding a gangsheet to cart.";
        setCartWarning(msg);
        setTimeout(() => setCartWarning(null), 8000);
        toast.error(msg);
        return;
      }

      /*
       * A sheet in the cart is a sheet the customer intends to buy, so it is
       * saved to their account first — and if it cannot be saved (artwork still
       * uploading), it must not go in the cart either: the order would reach the
       * printer with artwork nobody can fetch.
       */
      const saved = await saveRef.current();
      if (!saved.ok && saved.reason) {
        toast.error(saved.reason);
        return;
      }

      const normalized = ensureUniqueItemIds(currentItems);
      const designSignature = getGangsheetSnapshot(normalized);
      const duplicate = cartItems.find(
        (item) =>
          item.type === "gangsheet" &&
          typeof (item as any).designSignature === "string" &&
          (item as any).designSignature === designSignature
      );
      if (duplicate) {
        // The same sheet is already there. Point at it rather than refusing: the
        // customer wanted this sheet in the cart, and it is.
        setCartLineId(duplicate.id);
        toast.success("This sheet is already in your cart.", { id: "cart-add" });
        return;
      }

      /*
       * Always the billed figures the header shows — roll width by run length,
       * floored at the minimum. The unused-space prompt used to swap these for a
       * "full" 23.5 x 23.5in sheet no setting defined, charging a signed-in
       * customer for more than the minimum they would otherwise have paid.
       */
      const priceToUse = headerInfo?.price || 0;
      const widthToUse = headerInfo?.widthIn || getSheetWidthIn();
      const heightToUse = headerInfo?.heightIn || getMinSheetLengthIn();

      // Add gang sheet without image first
      const gangSheetItem = {
        id: Date.now(),
        // The sheet's own name — every line used to read "Gang Sheet".
        name: saved.title || sheetTitle,
        // Which saved sheet this is, so Edit sheet reopens that sheet (its name
        // and record), and so its auto-nest setting comes back with it.
        designId: saved.designId ?? currentLoadedDesignId ?? undefined,
        autoNest: settings.autoNestStickers,
        type: "gangsheet",
        image: "/placeholder-gangsheet.png",
        items: normalized,
        designSignature,
        price: priceToUse,
        widthIn: widthToUse,
        heightIn: heightToUse,
        size: `${widthToUse.toFixed(1)}" × ${heightToUse.toFixed(1)}"`,
        copies: 1,
        color: "N/A",
        design: "Custom Gang Sheet",
        print: "DTF Transfer",
        itemSpacingIn: settings.spacing,
        sheetMarginIn: settings.marginSize,
      };


      setCartItems((prev) => [...prev, gangSheetItem]);
      setCartLineId(gangSheetItem.id);
      showCartAddedToast({
        onViewCart: () => setShowCheckoutModal(true),
        sheetName: currentLoadedDesignTitle || draftDesignTitle,
      });

      if (fromUnusedSpacePrompt && user?.role === "CUSTOMER") {
        // Fire-and-forget: the email notification is non-critical. Gated on a
        // confirmed customer role so non-customer sessions don't generate a
        // guaranteed 403 from the /customer/* role middleware.
        apiFetch("/customer/notifications/gangsheet-utilization-warning", {
          method: "POST",
          body: JSON.stringify({
            billedPrice: priceToUse,
            sheetWidthIn: widthToUse,
            billedLengthIn: heightToUse,
            usedLengthIn: headerInfo?.usedHeightIn ?? 0,
          }),
        }).catch(() => {
          // Silent — the cart flow has already succeeded; the email is best-effort.
        });
      }

      // Try to capture image in background
      try {
        const imageDataUrl = await captureArtboard();
        console.log("Artboard captured successfully");
        setCartItems((prev) =>
          prev.map((item) =>
            item.id === gangSheetItem.id
              ? { ...item, image: imageDataUrl }
              : item
          )
        );
      } catch (captureError) {
        console.warn("Image capture failed, using placeholder:", captureError);
      }
    } catch (error) {
      console.error("Failed to add gang sheet:", error);
      alert("Failed to add gang sheet to cart");
    }
  };

  /**
   * Replaces the cart line this board came from, keeping its quantity and place
   * in the cart. The alternative — adding another line — is what "Start a new
   * sheet" is for.
   */
  const updateCartSheet = async (options: { silent?: boolean } = {}) => {
    const currentItems = getCurrentItems();
    if (!cartLine || !currentItems?.length) return;
    const normalized = ensureUniqueItemIds(currentItems);
    const widthIn = headerInfo?.widthIn || getSheetWidthIn();
    const heightIn = headerInfo?.heightIn || getMinSheetLengthIn();
    const updated = {
      ...cartLine,
      // A rename on the board shows in the cart too.
      name: sheetTitle,
      designId: currentLoadedDesignId ?? cartLine.designId,
      autoNest: settings.autoNestStickers,
      items: normalized,
      designSignature: getGangsheetSnapshot(normalized),
      price: headerInfo?.price || 0,
      widthIn,
      heightIn,
      size: `${widthIn.toFixed(1)}" × ${heightIn.toFixed(1)}"`,
      itemSpacingIn: settings.spacing,
      sheetMarginIn: settings.marginSize,
      // Without a snapshot the cart draws the sheet from these items, which is
      // accurate and free — so the stale one goes rather than being kept.
      image: "/placeholder-gangsheet.png",
    };
    setCartItems((prev) => prev.map((line) => (line.id === cartLine.id ? updated : line)));
    /*
     * A screenshot costs a full render of the board, and these run every time
     * editing settles. The cart's own preview covers it until the customer does
     * something deliberate, which is when a snapshot is worth taking.
     */
    if (options.silent) return;
    toast.success("Cart updated with your changes.", { id: "cart-add" });
    try {
      const imageDataUrl = await captureArtboard();
      setCartItems((prev) =>
        prev.map((line) => (line.id === cartLine.id ? { ...line, image: imageDataUrl } : line)),
      );
    } catch {
      // The preview is cosmetic; the sheet itself is already updated.
    }
  };

  /**
   * Opens a cart sheet back on the artboard.
   *
   * The board becomes that cart line, so anything changed from here updates it
   * — the same relationship as the sheet you have just added. Without this, a
   * sheet already in the cart could only be removed and rebuilt.
   */
  const editCartSheet = (line: any) => {
    const items = Array.isArray(line?.items) ? line.items : [];
    if (items.length === 0) {
      toast.error("This sheet has no artwork to edit.");
      return;
    }
    const open = () => {
      const snapshot = getGangsheetSnapshot(items);
      setArtboardData({ items, counter: Date.now() });
      setLoadedDesignData({ items, counter: Date.now() });
      setBaselineSnapshot(snapshot);
      setSettings((prev) => ({
        ...prev,
        spacing: typeof line.itemSpacingIn === "number" ? line.itemSpacingIn : prev.spacing,
        marginSize: typeof line.sheetMarginIn === "number" ? line.sheetMarginIn : prev.marginSize,
        autoNestStickers: typeof line.autoNest === "boolean" ? line.autoNest : prev.autoNestStickers,
      }));
      /*
       * The sheet comes back as itself: its name, and the saved record it was
       * added from, so autosave keeps writing to that sheet. The header kept
       * whatever name the board had before, and edits could be saved into a
       * different sheet.
       */
      if (line.designId) {
        setCurrentLoadedDesignId(String(line.designId));
        setCurrentLoadedDesignString(snapshot);
      } else {
        // A line added before lines recorded their sheet: save it as its own
        // sheet rather than into whichever sheet was open before.
        setCurrentLoadedDesignId(null);
        setCurrentLoadedDesignString(null);
      }
      setCurrentLoadedDesignTitle(line.name && line.name !== "Gang Sheet" ? line.name : null);
      setDraftDesignTitle(null);
      setCartLineId(line.id);
      // Choosing Edit sheet is choosing to change the cart's version.
      setCartFollowLineId(line.id);
      setShowCheckoutModal(false);
      toast.success("Editing this sheet — your changes update the cart.", { id: "cart-add" });
    };
    // Already the board's own line: nothing to swap in, so nothing to warn about
    // — but choosing Edit sheet is still choosing to change the cart's version.
    if (line.id === cartLineId) {
      setCartFollowLineId(line.id);
      setShowCheckoutModal(false);
      return;
    }
    void leaveBoard(
      {
        title: "Unsaved Changes",
        message: "You have unsaved changes. Do you want to save before opening the cart sheet?",
        primaryLabel: "Save & Open",
        secondaryLabel: "Discard & Open",
      },
      open,
    );
  };

  /*
   * A sheet in the cart stays in step with the board.
   *
   * Pressing an "Update Cart" button was one more thing to remember, and
   * forgetting it meant checking out the sheet as it was several images ago.
   * Changes land on the cart line a moment after the board settles, so the cart
   * always holds what is on screen.
   */
  const CART_SYNC_DELAY_MS = 1200;
  const cartSyncRef = useRef<(options?: { silent?: boolean }) => Promise<void>>(async () => {});
  cartSyncRef.current = updateCartSheet;
  useEffect(() => {
    // Only once the customer has said this board's changes belong to its cart
    // line (Update cart, or opening it with Edit sheet).
    if (!cartLine || !followsCart) return;
    if (cartLine.designSignature === currentSnapshot && cartLine.name === sheetTitle) return;
    const timer = setTimeout(() => {
      void cartSyncRef.current({ silent: true });
    }, CART_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentSnapshot, cartLine, followsCart, sheetTitle]);

  /** "Update the cart": this board's changes go into its cart line, now and from here on. */
  const followCartWithChanges = () => {
    if (!cartLine) return;
    setCartFollowLineId(cartLine.id);
    void cartSyncRef.current();
  };

  /**
   * "Save as a new sheet": the cart keeps its version; the board, with its
   * changes, becomes a separate sheet with a name of its own. Autosave then
   * creates it (the board no longer points at the in-cart sheet's record).
   */
  const branchFromCartSheet = () => {
    if (!cartLine) return;
    const kept = cartLine.name || sheetTitle;
    const name = nextCopyName(sheetTitle, [
      ...savedDesigns.map((d: any) => d?.title),
      ...cartItems.map((line: any) => line?.name),
    ]);
    setCartLineId(null);
    setCartFollowLineId(null);
    setCurrentLoadedDesignId(null);
    setCurrentLoadedDesignString(null);
    setCurrentLoadedDesignTitle(null);
    setDraftDesignTitle(name);
    toast.success(`Saving this as a new sheet, “${name}”. Your cart still has “${kept}”.`, { id: "cart-decision" });
  };

  /**
   * Clears the board for a separate sheet, so the next add is a new cart line.
   *
   * No "are you sure": the sheet being cleared is saved to the account, and if it
   * is in the cart it stays there — there is nothing to lose. A guest, who has no
   * account to save to, still gets the choice.
   */
  const startNewSheet = () => {
    void leaveBoard(
      {
        title: "Unsaved Changes",
        message: "You have unsaved changes. Do you want to save before starting a new sheet?",
        primaryLabel: "Save & Start New",
        secondaryLabel: "Discard & Start New",
      },
      () => {
        setCartLineId(null);
        clearWorkspace();
      },
    );
  };

  const addToCartRef = useRef<() => Promise<void> | void>(() => {});

  const handleAddGangSheetToCart = async () => {
    // Already in the cart, and kept in step with the board — so this is the
    // customer asking to see it.
    if (cartSheetState === "current") {
      setShowCheckoutModal(true);
      return;
    }
    const currentItems = getCurrentItems();
    // The same length the header bills and the print export produces.
    const usedHeight =
      Array.isArray(currentItems) && currentItems.length > 0
        ? sheetContentLengthIn(currentItems, getSheetWidthIn(), settings.marginSize, settings.spacing)
        : 0;
    /*
     * Shorter than the admin's minimum billable length: the sheet is billed at
     * the minimum, so say so before it goes in the cart. This compared against a
     * hard-coded 23.5in and priced a 23.5 x 23.5in sheet, which no setting held.
     */
    const minLengthIn = getMinSheetLengthIn();
    const underMinimum = usedHeight < minLengthIn - 0.01;

    if (isLoggedIn && underMinimum) {
      setUnderUtilizedMeta({
        billedPrice: headerInfo?.price || 0,
        usedLengthIn: usedHeight,
        minLengthIn,
        sheetWidthIn: getSheetWidthIn(),
      });
      setShowUnderUtilizedCartConfirm(true);
      return;
    }

    setShowUnderUtilizedCartConfirm(false);
    setUnderUtilizedMeta(null);
    await addGangSheetToCartNow();
  };

  const handleReorderToCart = async (orderId: string) => {
    const order = await apiFetch(`/customer/orders/${orderId}`);
    const orderItems = Array.isArray(order?.items) ? order.items : [];
    if (orderItems.length === 0) {
      toast.error("No items found in this order");
      return;
    }

    const mapped = orderItems.map((item: any, idx: number) => {
      const quantity = Number(item?.quantity || 1);
      const type = item?.type || "gangsheet";
      const isGangsheet = type === "gangsheet";
      /*
       * The same sheet, on the roll it was laid out for.
       *
       * The width was set to today's roll width, which slipped a sheet built for
       * a roll that has since changed past checkout's width check — its placements
       * would print on a roll they do not fit. Kept as recorded, checkout refuses
       * it with a clear message instead.
       */
      // `rollWidthIn` is the roll the order printed on (the server applies the
      // printer's rule for orders that predate recording it).
      const recordedWidthIn = Number(item?.rollWidthIn || 0);
      const billed = billableSheetDimensions(
        Number(item?.sheetHeightIn || item?.heightIn || 0),
      );
      const widthIn = isGangsheet && recordedWidthIn > 0 ? recordedWidthIn : billed.widthIn;
      /*
       * Priced at today's rate — not the `unitPrice` stored on the old order,
       * which the server would not charge. `repriceCartLine` (via the cart's
       * pricing effect) keeps it current from here on.
       */
      const unitPrice = +(billed.areaSf * getPricePerSqFt()).toFixed(2);

      return {
        id: Date.now() + idx,
        name: item?.name || "Gang Sheet",
        type,
        image: item?.previewImage || "/placeholder-gangsheet.png",
        /*
         * Where every graphic sits. Without these a reordered sheet reached
         * checkout with no artwork and became an order the printer could not
         * print.
         */
        items: Array.isArray(item?.artboardItems) ? item.artboardItems : undefined,
        itemSpacingIn: typeof item?.itemSpacingIn === "number" ? item.itemSpacingIn : undefined,
        sheetMarginIn: typeof item?.sheetMarginIn === "number" ? item.sheetMarginIn : undefined,
        price: unitPrice,
        quantity,
        widthIn,
        heightIn: billed.heightIn,
        size: `${widthIn.toFixed(1)}" × ${billed.heightIn.toFixed(1)}"`,
        color: item?.color || "N/A",
        design: item?.description || "Reorder Item",
        print: item?.print || "DTF Transfer",
      };
    });

    /*
     * A gang sheet with nothing on it cannot be printed, so it is not added.
     * Orders placed before placements were recorded have none to copy.
     */
    const printable = mapped.filter((line: any) => line.type !== "gangsheet" || (Array.isArray(line.items) && line.items.length > 0));
    if (printable.length < mapped.length) {
      toast.error(
        printable.length === 0
          ? "This order can't be reordered because its artwork layout wasn't saved. Please rebuild the sheet in the editor."
          : "Some sheets in this order can't be reordered because their artwork layout wasn't saved.",
      );
    }
    if (printable.length === 0) return;

    setCartItems((prev) => [...prev, ...printable]);
    setShowOrderHistoryModal(false);
    setShowCheckoutModal(true);
  };

  addToCartRef.current = handleAddGangSheetToCart;

  /** True while any dialog owns the screen — see the shortcut handler above. */
  const anyDialogOpen =
    showSaveModal ||
    showLoadModal ||
    showAccountModal ||
    showAuthModal ||
    showOrderHistoryModal ||
    showOrderDetailsModal ||
    showCheckoutModal ||
    showMobileNotice ||
    showClearArtboardConfirm ||
    showUnderUtilizedCartConfirm ||
    Boolean(unsavedPrompt);
  dialogOpenRef.current = anyDialogOpen;

  const currentItems = getCurrentItems();
  const itemCount = currentItems.reduce((sum: number, it: any) => {
    const rendered = computeRenderCopies(
      { widthIn: it.widthIn, heightIn: it.heightIn, copies: Number(it.copies) || 1 },
      getSheetWidthIn(),
      settings.marginSize,
      settings.spacing,
    );
    return sum + rendered;
  }, 0);

  return (
    <div className="relative flex flex-col h-screen w-screen bg-white">
      <ErrorBoundary name="The header">
        <Header
          info={
            headerInfo
              ? {
                  ...headerInfo,
                  name: currentLoadedDesignTitle || draftDesignTitle || headerInfo.name,
                }
              : undefined
          }
          itemCount={itemCount}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onUndo={historyState.undo}
          onRedo={historyState.redo}
          onMenuClick={() => setIsSidebarOpen(true)}
          isSidebarOpen={isSidebarOpen}
          onCartClick={() => setShowCheckoutModal(true)}
          onToggleDpiHighlight={
            dpiFlaggedCount > 0 ? () => setIsDpiHighlighting((v) => !v) : undefined
          }
          isDpiHighlighting={isDpiHighlighting}
          cartCount={cartItems.length}
          onAddGangSheetToCart={handleAddGangSheetToCart}
          canAddGangSheetToCart={getCurrentItems().length > 0}
          cartSheetState={cartSheetState}
          /* A guest has no account to save to, and should know it before they
             spend an hour on a sheet. */
          saveState={
            !canAutosave && currentItems.length > 0
              ? isLoggedIn
                ? "error"
                : "guest"
              : saveState
          }
          /* Why it is not saved, for the chip's tooltip — otherwise the only way
             to find out is to click it. */
          saveErrorMessage={
            !canAutosave && isLoggedIn
              ? "Gang sheets are saved to customer accounts."
              : saveError
          }
          isSheetSaved={Boolean(currentLoadedDesignId) && !hasUnsavedChanges}
          onRetrySave={() => {
            void saveRef.current().then((result) => {
              if (result.ok) toast.success("Gang sheet saved");
              else if (result.reason) toast.error(result.reason);
            });
          }}
          isLoggedIn={isLoggedIn}
          canSaveLoaded={Boolean(currentLoadedDesignId && hasUnsavedChanges && !isGangsheetBusy)}
          canRenameDesign
          onProfileClick={() => {
            setShowAccountModal(true);
            setIsSidebarOpen(false);
          }}
          profileAvatarUrl={user?.avatarUrl || null}
          profileName={user?.name || user?.email || undefined}
          profileLabel={(user?.name || user?.email || "")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((s: string) => s.charAt(0).toUpperCase())
            .join("")}
          profileBgClass={(() => {
            const avatarBgClasses = [
              "bg-red-600",
              "bg-orange-600",
              "bg-amber-600",
              "bg-yellow-600",
              "bg-lime-600",
              "bg-green-600",
              "bg-emerald-600",
              "bg-teal-600",
              "bg-cyan-600",
              "bg-sky-600",
              "bg-blue-600",
              "bg-indigo-600",
              "bg-violet-600",
              "bg-purple-600",
              "bg-fuchsia-600",
              "bg-pink-600",
              "bg-rose-600",
            ] as const;
            const first = (user?.name || "").trim().charAt(0).toUpperCase();
            const idx = first >= "A" && first <= "Z" ? first.charCodeAt(0) - 65 : 0;
            return avatarBgClasses[idx % avatarBgClasses.length];
          })()}
          onRenameDesign={async (newTitle) => {
            /*
             * Nothing saved yet — keep the name locally and let it seed the save
             * dialog. There is no design record to PATCH, and refusing the rename
             * is what made a fresh board unnameable.
             */
            if (!currentLoadedDesignId) {
              setDraftDesignTitle(newTitle);
              return;
            }
            try {
              await apiFetch(`/customer/designs/${currentLoadedDesignId}`, {
                method: "PATCH",
                body: JSON.stringify({ title: newTitle }),
              });
              setCurrentLoadedDesignTitle(newTitle);
              updateSavedDesignSnapshot(currentLoadedDesignId, {
                title: newTitle,
                time: formatDesignTime(new Date().toISOString()),
              });
              toast.success(`Renamed to "${newTitle}" gangsheet`);
              fetchDesigns();
            } catch {
              toast.error("Failed to rename gangsheet");
            }
          }}
          onSignInClick={() => {
            setAuthView("login");
            setShowAuthModal(true);
          }}
          onSaveLoaded={currentLoadedDesignId ? saveLoadedGangsheet : undefined}
        />
      </ErrorBoundary>
      <ErrorBoundary name="That notice" resetKey={showMobileNotice} onDismiss={() => setShowMobileNotice(false)}>
        <MobileNoticeModal
          isOpen={showMobileNotice}
          onDismiss={(dontShowAgain) => {
            if (dontShowAgain) {
              try {
                localStorage.setItem("hideMobileNotice", "1");
              } catch {}
            }
            setShowMobileNotice(false);
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary name="That window" resetKey={Boolean(unsavedPrompt)} onDismiss={() => setUnsavedPrompt(null)}>
        <UnsavedChangesModal
          isOpen={Boolean(unsavedPrompt)}
          title={unsavedPrompt?.title}
          message={unsavedPrompt?.message || ""}
          primaryLabel={unsavedPrompt?.primaryLabel || "Save & Continue"}
          secondaryLabel={unsavedPrompt?.secondaryLabel || "Discard & Continue"}
          isBusy={isGangsheetBusy}
          onPrimary={handleSaveAndContinue}
          onSecondary={handleDiscardAndContinue}
          onCancel={cancelPendingAction}
        />
      </ErrorBoundary>
      <ErrorBoundary name="That window" resetKey={showClearArtboardConfirm} onDismiss={() => setShowClearArtboardConfirm(false)}>
        <ConfirmModal
          isOpen={showClearArtboardConfirm}
          title="Clear Artboard"
          message="Are you sure you want to clear the artboard? This cannot be undone."
          confirmLabel="Clear Artboard"
          danger
          onConfirm={() => {
            setShowClearArtboardConfirm(false);
            clearWorkspace();
          }}
          onCancel={() => setShowClearArtboardConfirm(false)}
        />
      </ErrorBoundary>
      <ErrorBoundary name="That window" resetKey={showUnderUtilizedCartConfirm} onDismiss={() => setShowUnderUtilizedCartConfirm(false)}>
        <UnderUtilizedSheetModal
          isOpen={showUnderUtilizedCartConfirm}
          amount={underUtilizedMeta?.billedPrice || 0}
          usedLengthIn={underUtilizedMeta?.usedLengthIn ?? 0}
          minLengthIn={underUtilizedMeta?.minLengthIn ?? getMinSheetLengthIn()}
          sheetWidthIn={underUtilizedMeta?.sheetWidthIn ?? getSheetWidthIn()}
          onConfirm={async () => {
            setShowUnderUtilizedCartConfirm(false);
            setUnderUtilizedMeta(null);
            await addGangSheetToCartNow(true);
          }}
          onCancel={() => {
            setShowUnderUtilizedCartConfirm(false);
            setUnderUtilizedMeta(null);
          }}
        />
      </ErrorBoundary>
      {/* Asked once, on the first change to a sheet that is in the cart. Sits at
          the bottom, clear of the image toolbar at the top of the sheet. */}
      {cartDecisionPending && !showCheckoutModal && (
        <div role="status" className="fixed bottom-28 left-1/2 z-50 -translate-x-1/2 w-[calc(100vw-2rem)] max-w-xl">
          <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-lg sm:flex-row sm:items-center">
            <p className="flex-1 text-[13px] leading-snug text-gray-700">
              <span className="font-semibold text-gray-900">“{cartLine?.name || sheetTitle}” is in your cart.</span>{" "}
              Update the cart with these changes, or keep the cart as it is and save this as a new sheet?
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={branchFromCartSheet}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                Save as new sheet
              </button>
              <button
                onClick={followCartWithChanges}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-800"
              >
                Update cart
              </button>
            </div>
          </div>
        </div>
      )}
      {cartWarning && (
        <div className="absolute mt-10 top-10 left-1/2 -translate-x-1/2 z-50">
          <div className="inline-flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-500 px-4 py-2 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <p
              style={{
                fontFamily: "Roboto",
                fontWeight: 500,
                fontSize: "13px",
                lineHeight: "20px",
                letterSpacing: "0px",
                color: "#1D4ED8",
              }}
            >
              {cartWarning}
            </p>
          </div>
        </div>
      )}
      <ErrorBoundary name="The design area">
        <Artboard
          onHeaderInfoChange={setHeaderInfo}
          highlightLowDpi={isDpiHighlighting}
          onActionPerformed={(action) => {
            setTimeout(() => {
              setLastAction(action);
              if (
                action?.type === "delete" &&
                action.id != null &&
                action.payload?.item
              ) {
                setDeletedItems((prev) => ({
                  ...prev,
                  [action.id!]: action.payload.item,
                }));
              }
            }, 0);
          }}
          showRulers={settings.showRulers && !isMobile}
          showGrid={settings.showGrid}
          snapToGrid={settings.snapToGrid}
          showMargins={settings.showMargins}
          marginSize={settings.marginSize}
          autoNestStickers={settings.autoNestStickers}
          spacing={settings.spacing}
          canvasBg={settings.canvasBg}
          autoCropUploads={settings.autoCropUploads}
          /* "N" belongs to the board, so it stops while a dialog is in front of it. */
          shortcutsEnabled={!anyDialogOpen}
          onRequestAutoNest={(enabled) => updateSetting("autoNestStickers", enabled)}
          onUpdateSetting={(key, value) => updateSetting(key as keyof typeof settings, value)}
          onDataChange={setArtboardData}
          initialData={loadedDesignData}
          onHistoryChange={setHistoryState}
        />
      </ErrorBoundary>
      <ErrorBoundary name="The sidebar" resetKey={isSidebarOpen} onDismiss={() => setIsSidebarOpen(false)}>
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          settings={settings}
          onUpdateSetting={updateSetting}
          onCreateGangSheet={() => {
            setIsSidebarOpen(false);
            attemptCreateNewGangsheet();
          }}
          hasArtwork={currentItems.length > 0}
          onOpenSaveModal={() => {
            if (!isLoggedIn) {
              setAuthView("login");
              setShowAuthModal(true);
              setIsSidebarOpen(false);
              return;
            }
            pendingAfterSaveRef.current = null;
            setShowSaveModal(true);
            setIsSidebarOpen(false);
          }}
          onOpenLoadModal={() => {
            if (!isLoggedIn) {
              setAuthView("login");
              setShowAuthModal(true);
              setIsSidebarOpen(false);
              return;
            }
            fetchDesigns();
            setShowLoadModal(true);
            setIsSidebarOpen(false);
          }}
          onOpenAccountModal={() => {
            setShowAccountModal(true);
            setIsSidebarOpen(false);
          }}
          onOpenAuthModal={(view) => {
            setAuthView(view);
            setShowAuthModal(true);
            setIsSidebarOpen(false);
          }}
          onClearArtboard={() => {
            setIsSidebarOpen(false);
            attemptClearArtboard();
          }}
          isLoggedIn={isLoggedIn}
          user={user}
          onSignOut={() => signOut()}
        />
      </ErrorBoundary>
      <ErrorBoundary name="The save window" resetKey={showSaveModal} onDismiss={() => setShowSaveModal(false)}>
        <SaveGangSheetModal
          isOpen={showSaveModal}
          onClose={() => setShowSaveModal(false)}
          artboardData={artboardData}
          initialTitle={currentLoadedDesignTitle || draftDesignTitle}
          onSave={async (title: string, thumbnail: string) => {
            if (!isLoggedIn) {
              setAuthView("login");
              setShowAuthModal(true);
              return;
            }
            /*
             * The same save autosave uses, with the name this dialog collected.
             * There used to be a second copy of the create/update logic here, so
             * the two could disagree about whether a sheet was saved — and only
             * this one refused to store artwork that had not finished uploading.
             */
            const toastId = toast.loading("Saving gang sheet...");
            const result = await saveRef.current({ title: title.trim() || undefined, thumbnail });
            if (result.ok) {
              setShowSaveModal(false);
              toast.success(`Saved “${title.trim() || currentLoadedDesignTitle || "gang sheet"}”`, { id: toastId });
              const pending = pendingAfterSaveRef.current;
              pendingAfterSaveRef.current = null;
              if (pending) await pending();
            } else {
              toast.error(result.reason || "Failed to save gang sheet", { id: toastId });
            }
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary name="Your gang sheets" resetKey={showLoadModal} onDismiss={() => setShowLoadModal(false)}>
        <LoadGangSheetModal
          isOpen={showLoadModal}
          onClose={() => {
            setShowLoadModal(false);
            fetchDesigns(); // reset list on close
          }}
          designs={savedDesigns}
          onSearch={(term: string) => fetchDesigns(term)}
          onLoad={(id) => {
            setShowLoadModal(false);
            attemptLoadGangsheet(id);
          }}
          onRename={async (id, newTitle) => {
            await apiFetch(`/customer/designs/${id}`, {
              method: "PATCH",
              body: JSON.stringify({ title: newTitle }),
            });
            setSavedDesigns((prev) =>
              prev.map((d) => (d.id === id ? { ...d, title: newTitle } : d))
            );
          }}
          onDuplicate={async (id) => {
            const design = savedDesigns.find((d) => d.id === id);
            const newTitle = design ? `${design.title} (Copy)` : "Untitled (Copy)";
            await apiFetch(`/customer/designs/${id}/duplicate`, {
              method: "POST",
              body: JSON.stringify({ newTitle }),
            });
            fetchDesigns();
          }}
          onDelete={async (id) => {
            await apiFetch(`/customer/designs/${id}`, { method: "DELETE" });
            setSavedDesigns((prev) => prev.filter((d) => d.id !== id));
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary name="Account settings" resetKey={showAccountModal} onDismiss={() => setShowAccountModal(false)}>
        <AccountSettingsModal
          isOpen={showAccountModal}
          onClose={() => setShowAccountModal(false)}
          user={user}
          onOpenOrderHistory={() => {
            setShowAccountModal(false);
            setShowOrderHistoryModal(true);
          }}
          onViewOrderDetails={() => {
            setShowAccountModal(false);
            setShowOrderDetailsModal(true);
          }}
          onSignOut={() => {
            signOut();
            setShowAccountModal(false);
          }}
          onAuthSuccess={(userData) => {
            setIsLoggedIn(true);
            setUser(userData);
            setShowAccountModal(false);
          }}
          onAddAccount={() => {
            setIsSubAccountCreation(true);
            setAuthView("register");
            setShowAuthModal(true);
            setShowAccountModal(false);
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary name="Order history" resetKey={showOrderHistoryModal} onDismiss={() => setShowOrderHistoryModal(false)}>
        <OrderHistoryModal
          isOpen={showOrderHistoryModal}
          onClose={() => setShowOrderHistoryModal(false)}
          onReorderToCart={handleReorderToCart}
          onViewDetails={(orderId) => {
            setSelectedOrderId(orderId);
            setShowOrderHistoryModal(false);
            setShowOrderDetailsModal(true);
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary name="Order details" resetKey={showOrderDetailsModal} onDismiss={() => setShowOrderDetailsModal(false)}>
        <OrderDetailsModal
          onReorderToCart={handleReorderToCart}
          isOpen={showOrderDetailsModal}
          onClose={() => {
            setShowOrderDetailsModal(false);
            setSelectedOrderId(null);
          }}
          orderId={selectedOrderId}
        />
      </ErrorBoundary>
      <ErrorBoundary name="Checkout" resetKey={showCheckoutModal} onDismiss={() => setShowCheckoutModal(false)}>
        <CheckoutModal
          isLoggedIn={isLoggedIn}
          onRequireSignIn={() => {
            // The cart is kept; the modal reopens on top of it after signing in.
            setAuthView("login");
            setShowAuthModal(true);
          }}
          isOpen={showCheckoutModal}
          onClose={() => setShowCheckoutModal(false)}
          cartItems={cartItems}
          onUpdateCart={setCartItems}
          onEditSheet={editCartSheet}
          onStartNewSheet={startNewSheet}
          onClearCart={() => {
            setCartItems([]);
            setCartLineId(null);
          }}
          onCheckoutSuccess={() => {
            /*
             * The order is placed: the cart is empty and the board starts fresh,
             * so the next sheet is not built on top of one already bought. The
             * sheet itself is not lost — it is saved, and the order is in history.
             */
            setCartItems([]);
            clearWorkspace();
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary name="Sign in" resetKey={showAuthModal} onDismiss={() => setShowAuthModal(false)}>
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => {
            setShowAuthModal(false);
            setIsSubAccountCreation(false);
            setResetToken(null);
            setResetEmail(null);
          }}
          initialView={authView}
          isSubAccountCreation={isSubAccountCreation}
          resetToken={resetToken}
          resetEmail={resetEmail}
          onAuthSuccess={(user) => {
            setIsLoggedIn(true);
            setUser(user);
            setShowAuthModal(false);
            setIsSubAccountCreation(false);
            setResetToken(null);
            setResetEmail(null);
          }}
          onSubAccountCreated={() => {
            setShowAuthModal(false);
            setIsSubAccountCreation(false);
            setResetToken(null);
            setResetEmail(null);
            setShowAccountModal(true);
          }}
        />
      </ErrorBoundary>
    </div>
  );
}
