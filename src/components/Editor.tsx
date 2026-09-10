import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
import { getGangsheetSnapshot } from "../lib/utils/gangsheetState";
import { stripEmbeddedData } from "../lib/utils/assetIdentity";
import { stripEmbeddedImages } from "../lib/utils/payloadImages";
import { CANVAS, PRICING } from "../config/artboard.config";
import { loadEditorSettings, saveEditorSettings, type EditorSettings } from "../lib/utils/editorSettings";
import { getSheetWidthIn, getMinSheetLengthIn, usePricingSettings, billableSheetDimensions, getPricePerSqFt } from "../lib/utils/pricingRates";
import { computeRenderCopies } from "./artboard/lib/utils/layoutHelpers";

export default function Editor() {
  const { pricePerSqFt } = usePricingSettings();
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
    if (isLoggedIn && user?.id && user?.role === "CUSTOMER") {
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
  }, [cartItems, isLoggedIn, user?.id, user?.role]);

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) = redo.
  // Skipped while typing in form fields so we don't hijack the browser's native
  // text-editing undo/redo inside inputs and textareas.
  useEffect(() => {
    const isTextInputTarget = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (node.isContentEditable) return true;
      return false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInputTarget(e.target)) return;
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

  const [headerInfo, setHeaderInfo] = useState<{
    hasItem: boolean;
    areaSf?: number;
    widthIn?: number;
    heightIn?: number;
    name?: string;
    price?: number;
    lowDpiCount?: number;
    unknownDpiCount?: number;
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
    fullSheetPrice: number;
    utilizationPct: number | null;
  } | null>(null);

  const clearWorkspace = () => {
    setArtboardData({ items: [], counter: Date.now() });
    setLoadedDesignData({ items: [], counter: Date.now() });
    setCurrentLoadedDesignId(null);
    setCurrentLoadedDesignString(null);
    setCurrentLoadedDesignTitle(null);
    setLastAction(null);
    setDeletedItems({});
    setBaselineSnapshot(getGangsheetSnapshot([]));
    // A brand-new gangsheet always starts at the default 0.5 item spacing.
    setSettings((prev) => (prev.spacing === 0.5 ? prev : { ...prev, spacing: 0.5 }));
  };

  const mapItemsForSave = (items: any[]) => {
    const normalizedItems = ensureUniqueItemIds(items);
    const mappedItems = normalizedItems.map((it: any) => ({
      id: it.id,
      assetId: it.assetId || it.originalUrl || it.url,
      croppedUrl:
        it.autoCrop !== false
          ? (typeof it.croppedUrl === "string" && it.croppedUrl
              ? it.croppedUrl
              : typeof it.url === "string" && !it.url.startsWith("data:")
              ? it.url
              : undefined)
          : undefined,
      // Pixel dimensions of the croppedUrl source. Required for canvas-processed items
      // (canvas crop, BG removal) so the server calculates DPI from the actual source
      // pixel count instead of the DB's original widthPx, preventing upscaling.
      croppedWidthPx: it.croppedWidthPx || undefined,
      croppedHeightPx: it.croppedHeightPx || undefined,
      widthIn: it.widthIn,
      heightIn: it.heightIn,
      posX: it.posX,
      posY: it.posY,
      rotation: it.rotation || 0,
      copies: it.copies || 1,
      linked: Boolean(it.linked),
      autoCrop: it.autoCrop !== false,
    }));
    return { normalizedItems, mappedItems };
  };

  const saveLoadedGangsheet = async () => {
    if (!currentLoadedDesignId) return false;
    if (!isLoggedIn) {
      toast.error("Please sign in to save");
      setAuthView("login");
      setShowAuthModal(true);
      return false;
    }

    const items = getCurrentItems();
    const { normalizedItems, mappedItems } = mapItemsForSave(items);

    setIsGangsheetBusy(true);
    const toastId = toast.loading("Saving gangsheet...");
    try {
      let thumbnail: string | undefined;
      try {
        thumbnail = await captureArtboard();
      } catch {
        thumbnail = undefined;
      }

      await apiFetch(`/customer/designs/${currentLoadedDesignId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(thumbnail ? { thumbnail } : {}),
          artboardData: { items: mappedItems },
        }),
      });

      const nextSnapshot = getGangsheetSnapshot(normalizedItems);
      setBaselineSnapshot(nextSnapshot);
      setCurrentLoadedDesignString(nextSnapshot);
      setLoadedDesignData({ items: normalizedItems as any[], counter: Date.now() });
      setArtboardData({ items: normalizedItems as any[], counter: Date.now() });
      if (thumbnail) {
        updateSavedDesignSnapshot(currentLoadedDesignId, {
          thumbnail,
          time: formatDesignTime(new Date().toISOString()),
        });
      } else {
        updateSavedDesignSnapshot(currentLoadedDesignId, {
          time: formatDesignTime(new Date().toISOString()),
        });
      }
      fetchDesigns();

      toast.success("Gangsheet saved", { id: toastId });
      return true;
    } catch (err: any) {
      toast.error(err?.message || "Failed to save gangsheet", { id: toastId });
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
          });
          if (trimmed?.trimmedUrl) return trimmed.trimmedUrl as string;
        } catch {
        }

        return url;
      };

      const mappedItems = ensureUniqueItemIds(
        await Promise.all(
          items.map(async (it: any) => {
            const originalUrl = it.assetId;
            const autoCrop = it.autoCrop !== false;
            const savedCroppedUrl =
              typeof it.croppedUrl === "string" && it.croppedUrl ? it.croppedUrl : null;
            const url = autoCrop ? savedCroppedUrl || (await cropImage(originalUrl)) : originalUrl;
            return {
              id: it.id,
              url,
              // Restore croppedUrl so subsequent saves don't lose the export source.
              // Without this, re-saving a loaded design loses the data URL for
              // canvas-processed items, causing the server to fall back to the wrong source.
              croppedUrl: savedCroppedUrl || undefined,
              // Restore pixel dimensions of the canvas export source so the server DPI
              // calculator uses the correct pixel count on re-save or checkout.
              croppedWidthPx: typeof it.croppedWidthPx === "number" && it.croppedWidthPx > 0 ? it.croppedWidthPx : undefined,
              croppedHeightPx: typeof it.croppedHeightPx === "number" && it.croppedHeightPx > 0 ? it.croppedHeightPx : undefined,
              rotation: it.rotation || 0,
              locked: false,
              expanded: false,
              flipped: false,
              autoCrop,
              copies: it.copies || 1,
              widthIn: it.widthIn,
              heightIn: it.heightIn,
              posX: it.posX,
              posY: it.posY,
              linked: Boolean(it.linked),
              price: 0,
              originalUrl,
            };
          }),
        ),
      );

      const nextSnapshot = getGangsheetSnapshot(mappedItems);
      setLoadedDesignData({ items: mappedItems, counter: Date.now() });
      setArtboardData({ items: mappedItems, counter: Date.now() });
      setCurrentLoadedDesignId(id);
      setCurrentLoadedDesignString(nextSnapshot);
      setBaselineSnapshot(nextSnapshot);
      setCurrentLoadedDesignTitle(res?.title || null);
      setLastAction(null);
      setDeletedItems({});
      toast.success("Gangsheet loaded", { id: toastId });
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

  const attemptCreateNewGangsheet = () => {
    if (hasUnsavedChanges) {
      openUnsavedPrompt(
        {
          title: "Unsaved Changes",
          message: "You have unsaved changes. Do you want to save before creating a new gangsheet?",
          primaryLabel: "Save & Create New",
          secondaryLabel: "Discard & Create New",
        },
        async () => {
          clearWorkspace();
        },
      );
      return;
    }
    clearWorkspace();
  };

  const attemptLoadGangsheet = (id: string) => {
    if (hasUnsavedChanges) {
      openUnsavedPrompt(
        {
          title: "Unsaved Changes",
          message: "You have unsaved changes. Do you want to save before loading?",
          primaryLabel: "Save & Load",
          secondaryLabel: "Discard & Load",
        },
        async () => {
          await loadGangsheetById(id);
        },
      );
      return;
    }
    loadGangsheetById(id);
  };

  const attemptClearArtboard = () => {
    if (hasUnsavedChanges) {
      openUnsavedPrompt(
        {
          title: "Unsaved Changes",
          message: "You have unsaved changes. Do you want to save before clearing the artboard?",
          primaryLabel: "Save & Clear",
          secondaryLabel: "Discard & Clear",
        },
        async () => {
          clearWorkspace();
        },
      );
      return;
    }
    setShowClearArtboardConfirm(true);
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

  const addGangSheetToCartNow = async (forceFullSheetPrice: boolean = false) => {
    if (!isLoggedIn) {
      setAuthView("register");
      setShowAuthModal(true);
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

      const normalized = ensureUniqueItemIds(currentItems);
      const designSignature = getGangsheetSnapshot(normalized);
      const isDuplicate = cartItems.some(
        (item) =>
          item.type === "gangsheet" &&
          typeof (item as any).designSignature === "string" &&
          (item as any).designSignature === designSignature
      );
      if (isDuplicate) {
        const msg = "This exact gang sheet is already in your cart.";
        setCartWarning(msg);
        setTimeout(() => setCartWarning(null), 8000);
        return;
      }

      console.log("=== ADDING GANG SHEET TO CART ===");
      console.log("artboardData:", artboardData);
      console.log("artboardData.items:", artboardData?.items);

      const fullSheetAreaSf =
        (CANVAS.SHEET_WIDTH_IN * CANVAS.SHEET_HEIGHT_IN) /
        PRICING.SQUARE_INCHES_PER_SQ_FT;
      const fullSheetPrice = +(fullSheetAreaSf * pricePerSqFt).toFixed(2);
      const priceToUse = forceFullSheetPrice
        ? fullSheetPrice
        : headerInfo?.price || 0;
      const widthToUse = forceFullSheetPrice
        ? CANVAS.SHEET_WIDTH_IN
        : headerInfo?.widthIn || CANVAS.SHEET_WIDTH_IN;
      const heightToUse = forceFullSheetPrice
        ? CANVAS.SHEET_HEIGHT_IN
        : headerInfo?.heightIn || CANVAS.SHEET_HEIGHT_IN;

      // Add gang sheet without image first
      const gangSheetItem = {
        id: Date.now(),
        name: "Gang Sheet",
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

      console.log("gangSheetItem being added:", gangSheetItem);
      console.log("gangSheetItem.items:", gangSheetItem.items);

      setCartItems((prev) => [...prev, gangSheetItem]);

      if (forceFullSheetPrice && user?.role === "CUSTOMER") {
        // Fire-and-forget: the email notification is non-critical. Gated on a
        // confirmed customer role so non-customer sessions don't generate a
        // guaranteed 403 from the /customer/* role middleware.
        const utilizationPct =
          typeof headerInfo?.areaSf === "number" && fullSheetAreaSf > 0
            ? (headerInfo.areaSf / fullSheetAreaSf) * 100
            : null;

        apiFetch("/customer/notifications/gangsheet-utilization-warning", {
          method: "POST",
          body: JSON.stringify({
            fullSheetPrice,
            sheetWidthIn: CANVAS.SHEET_WIDTH_IN,
            sheetHeightIn: CANVAS.SHEET_HEIGHT_IN,
            utilizationPct,
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

  const handleAddGangSheetToCart = async () => {
    const currentItems = getCurrentItems();
    const used = (() => {
      if (!Array.isArray(currentItems) || currentItems.length === 0) {
        return { usedWidthIn: 0, usedHeightIn: 0 };
      }

      const canvasWidthIn = CANVAS.SHEET_WIDTH_IN;
      const effectiveMargin = settings.marginSize;
      const gap = CANVAS.GRID_GAP_IN;

      const bounds = currentItems.reduce(
        (acc: any, item: any) => {
          const copies = item.copies || 1;
          const scaledWidth = item.widthIn;
          const scaledHeight = item.heightIn;

          const maxAvailableWidth = Math.max(0, canvasWidthIn - 2 * effectiveMargin);
          const capacityCols = Math.max(
            1,
            Math.floor((maxAvailableWidth + gap) / (scaledWidth + gap)),
          );
          const visibleCols = Math.min(copies, capacityCols);
          const rows = Math.ceil(copies / capacityCols);

          const groupWidthRaw = visibleCols * scaledWidth + (visibleCols - 1) * gap;
          const groupWidth = Math.min(groupWidthRaw, maxAvailableWidth);
          const groupHeight = rows * scaledHeight + (rows - 1) * gap;

          const centeredLeft = effectiveMargin + (maxAvailableWidth - groupWidth) / 2;
          const rightBoundLeft = canvasWidthIn - effectiveMargin - groupWidth;
          const clampedLeft =
            copies > 1
              ? Math.max(effectiveMargin, Math.min(centeredLeft, rightBoundLeft))
              : Math.max(effectiveMargin, item.posX);
          const clampedTop = Math.max(effectiveMargin, item.posY);

          const left = clampedLeft;
          const top = clampedTop;
          const right = clampedLeft + groupWidth;
          const bottom = clampedTop + groupHeight;

          return {
            minX: Math.min(acc.minX, left),
            minY: Math.min(acc.minY, top),
            maxX: Math.max(acc.maxX, right),
            maxY: Math.max(acc.maxY, bottom),
          };
        },
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: 0,
          maxY: 0,
        },
      );

      return { usedWidthIn: Math.max(0, bounds.maxX), usedHeightIn: Math.max(0, bounds.maxY) };
    })();

    const usedHeight = used.usedHeightIn || 0;
    // Sheet width is fixed at 23.5", so we only gate on height utilization.
    const notFullyUtilized = usedHeight < CANVAS.SHEET_HEIGHT_IN - 0.01;

    if (isLoggedIn && notFullyUtilized) {
      const fullSheetAreaSf =
        (CANVAS.SHEET_WIDTH_IN * CANVAS.SHEET_HEIGHT_IN) /
        PRICING.SQUARE_INCHES_PER_SQ_FT;
      const fullSheetPrice = +(fullSheetAreaSf * pricePerSqFt).toFixed(2);
      const utilizationPct =
        typeof headerInfo?.areaSf === "number" && fullSheetAreaSf > 0
          ? (headerInfo.areaSf / fullSheetAreaSf) * 100
          : null;
      setUnderUtilizedMeta({ fullSheetPrice, utilizationPct });
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
      /*
       * Priced at today's rate from the sheet's own dimensions — not the
       * `unitPrice` stored on the old order.
       *
       * The server reprices at checkout regardless, so carrying the old figure
       * only meant the cart displayed a price the customer would not be charged.
       * After a rate or minimum-length change that gap is large.
       */
      const billed = billableSheetDimensions(
        Number(item?.sheetHeightIn || item?.heightIn || 0),
      );
      const unitPrice = +(billed.areaSf * getPricePerSqFt()).toFixed(2);

      return {
        id: Date.now() + idx,
        name: item?.name || "Gang Sheet",
        type,
        image: item?.previewImage || "/placeholder-gangsheet.png",
        items: Array.isArray(item?.artboardItems) ? item.artboardItems : undefined,
        price: unitPrice,
        quantity,
        // The billed shape, matching what checkout will charge for.
        widthIn: billed.widthIn,
        heightIn: billed.heightIn,
        size: `${billed.widthIn.toFixed(1)}" × ${billed.heightIn.toFixed(1)}"`,
        color: item?.color || "N/A",
        design: item?.description || "Reorder Item",
        print: item?.print || "DTF Transfer",
      };
    });

    setCartItems((prev) => [...prev, ...mapped]);
    setShowOrderHistoryModal(false);
    setShowCheckoutModal(true);
  };

  const currentItems = getCurrentItems();
  const itemCount = currentItems.reduce((sum: number, it: any) => {
    const rendered = computeRenderCopies(
      { widthIn: it.widthIn, heightIn: it.heightIn, copies: Number(it.copies) || 1 },
      CANVAS.SHEET_WIDTH_IN,
      settings.marginSize,
      settings.spacing,
    );
    return sum + rendered;
  }, 0);

  return (
    <div className="relative flex flex-col h-screen w-screen bg-white">
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
      <UnderUtilizedSheetModal
        isOpen={showUnderUtilizedCartConfirm}
        sheetSizeLabel={`${CANVAS.SHEET_WIDTH_IN.toFixed(1)}" × ${CANVAS.SHEET_HEIGHT_IN.toFixed(1)}"`}
        fullSheetAmount={underUtilizedMeta?.fullSheetPrice || 0}
        utilizationPct={underUtilizedMeta?.utilizationPct ?? null}
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
        onRequestAutoNest={(enabled) => updateSetting("autoNestStickers", enabled)}
        onUpdateSetting={(key, value) => updateSetting(key as keyof typeof settings, value)}
        onDataChange={setArtboardData}
        initialData={loadedDesignData}
        onHistoryChange={setHistoryState}
        onAddToCart={(item) => setCartItems((prev) => [...prev, item])}
      />
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
      <SaveGangSheetModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        artboardData={artboardData}
        initialTitle={currentLoadedDesignTitle || draftDesignTitle}
        onSave={async (title: string, thumbnail: string, data: any) => {
          if (!isLoggedIn) {
            setAuthView("login");
            setShowAuthModal(true);
            return;
          }

          /*
           * The billed dimensions the header is showing — roll width by run
           * length, floored at the minimum — so the cart line, the quote on
           * screen and the server's charge are the same three numbers.
           */
          const widthIn = headerInfo?.widthIn || getSheetWidthIn();
          const heightIn = headerInfo?.heightIn || getMinSheetLengthIn();
          const areaSqFt = headerInfo?.areaSf ?? (widthIn * heightIn) / 144;
          const price = headerInfo?.price ?? 0;

          const items = Array.isArray(data?.items) ? data.items : [];
          const normalizedItems = ensureUniqueItemIds(items);
          const mappedItems = normalizedItems.map((it: any) => ({
            id: it.id,
            assetId: it.assetId || it.originalUrl || it.url,
            croppedUrl:
              it.autoCrop !== false
                ? (typeof it.croppedUrl === "string" && it.croppedUrl
                    ? it.croppedUrl                                  // explicit export URL (Cloudinary or full-res data URL)
                    : typeof it.url === "string" && !it.url.startsWith("data:")
                    ? it.url                                         // Cloudinary display URL fallback
                    : undefined)
                : undefined,
            croppedWidthPx: it.croppedWidthPx || undefined,
            croppedHeightPx: it.croppedHeightPx || undefined,
            widthIn: it.widthIn,
            heightIn: it.heightIn,
            posX: it.posX,
            posY: it.posY,
            rotation: it.rotation || 0,
            copies: it.copies || 1,
            linked: Boolean(it.linked),
            autoCrop: it.autoCrop !== false,
          }));

          // Pre-flight: the /customer/designs routes are gated to CUSTOMER role
          // server-side. Without this check the user clicks Save, waits, and
          // gets a useless "Forbidden" toast. Catch it up-front with a clear message.
          if (!isLoggedIn || !user?.id) {
            toast.error("Please sign in to save your design.");
            setShowAuthModal(true);
            return;
          }
          if (user.role !== "CUSTOMER") {
            toast.error(
              "This account can't save designs. Please sign in with a customer account.",
            );
            return;
          }

          let toastId: string | undefined;
          try {
            setIsGangsheetBusy(true);
            toastId = toast.loading("Saving gangsheet...");
            if (currentLoadedDesignId) {
              await apiFetch(`/customer/designs/${currentLoadedDesignId}`, {
                method: "PATCH",
                body: JSON.stringify({
                  title,
                  thumbnail,
                  artboardData: { items: mappedItems },
                }),
              });
              setCurrentLoadedDesignTitle(title);
              setDraftDesignTitle(null);
              const nextSnapshot = getGangsheetSnapshot(normalizedItems);
              setCurrentLoadedDesignString(nextSnapshot);
              setBaselineSnapshot(nextSnapshot);
              toast.success(`Saved "${title.trim() || "Gang Sheet"}"`, { id: toastId });
              updateSavedDesignSnapshot(currentLoadedDesignId, {
                title,
                thumbnail,
                time: formatDesignTime(new Date().toISOString()),
              });
              setLoadedDesignData({ items: normalizedItems as any[], counter: Date.now() });
              setArtboardData({ items: normalizedItems as any[], counter: Date.now() });
            } else {
              const created = await apiFetch("/customer/designs", {
                method: "POST",
                body: JSON.stringify({
                  title,
                  thumbnail,
                  size: { widthIn, heightIn },
                  pricing: { areaSqFt, price },
                  artboardData: { items: mappedItems },
                }),
              });
              const createdId = created?.id ? String(created.id) : null;
              const nextSnapshot = getGangsheetSnapshot(normalizedItems);
              if (createdId) {
                setCurrentLoadedDesignId(createdId);
                setCurrentLoadedDesignTitle(title);
                setDraftDesignTitle(null);
                setCurrentLoadedDesignString(nextSnapshot);
              }
              setBaselineSnapshot(nextSnapshot);
              setLoadedDesignData({ items: normalizedItems as any[], counter: Date.now() });
              setArtboardData({ items: normalizedItems as any[], counter: Date.now() });
              setLastAction(null);
              toast.success("Design saved", { id: toastId });
            }
            setShowSaveModal(false);
            fetchDesigns();

            const pending = pendingAfterSaveRef.current;
            pendingAfterSaveRef.current = null;
            if (pending) {
              await pending();
            }
          } catch (err: any) {
            // Auth gate from /customer/* role middleware — translate "Forbidden"
            // into something the user can act on.
            const isAuthGate = err?.status === 403 || err?.status === 401;
            const fallback = currentLoadedDesignId
              ? "Failed to update gangsheet"
              : "Failed to save gangsheet";
            const message = isAuthGate
              ? "Your session can't save designs. Please sign in with a customer account."
              : err?.message || fallback;
            toast.error(message, toastId ? { id: toastId } : undefined);
          } finally {
            setIsGangsheetBusy(false);
          }
        }}
      />
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
      <OrderDetailsModal
        onReorderToCart={handleReorderToCart}
        isOpen={showOrderDetailsModal}
        onClose={() => {
          setShowOrderDetailsModal(false);
          setSelectedOrderId(null);
        }}
        orderId={selectedOrderId}
      />
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
        onCheckoutSuccess={() => {
          setCartItems([]);
        }}
      />
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
    </div>
  );
}
