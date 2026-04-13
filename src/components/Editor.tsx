import { useState, useEffect, useRef } from "react";
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
import { captureArtboard } from "./artboard/lib/utils";
import { apiFetch } from "../lib/utils/api";
import { getGangsheetSnapshot } from "../lib/utils/gangsheetState";

export default function Editor() {
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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
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
    const token = localStorage.getItem("token");
    if (token) {
      apiFetch("/auth/me")
        .then((userData) => {
          setUser(userData);
          setIsLoggedIn(true);
        })
        .catch(() => {
          localStorage.removeItem("token");
          setIsLoggedIn(false);
          setUser(null);
        });
    }
  }, []);

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
    localStorage.setItem("cart", JSON.stringify(cartItems));
  }, [cartItems]);

  const [headerInfo, setHeaderInfo] = useState<{
    hasItem: boolean;
    areaSf?: number;
    widthIn?: number;
    heightIn?: number;
    name?: string;
    price?: number;
  }>();
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

  const currentSnapshot = getGangsheetSnapshot(getCurrentItems());
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

  const clearWorkspace = () => {
    setArtboardData({ items: [], counter: Date.now() });
    setLoadedDesignData({ items: [], counter: Date.now() });
    setCurrentLoadedDesignId(null);
    setCurrentLoadedDesignString(null);
    setCurrentLoadedDesignTitle(null);
    setLastAction(null);
    setDeletedItems({});
    setBaselineSnapshot(getGangsheetSnapshot([]));
  };

  const mapItemsForSave = (items: any[]) => {
    const normalizedItems = ensureUniqueItemIds(items);
    const mappedItems = normalizedItems.map((it: any) => ({
      id: it.id,
      assetId: it.originalUrl || it.assetId || it.url,
      croppedUrl:
        it.autoCrop !== false &&
        typeof it.url === "string" &&
        !it.url.startsWith("data:")
          ? it.url
          : undefined,
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
  const [settings, setSettings] = useState({
    showGrid: true,
    showRulers: true,
    showMargins: false,
    snapToGrid: false,
    autoNestStickers: false,
    spacing: 0.1,
    marginSize: 0.15,
  });

  const updateSetting = (key: keyof typeof settings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddGangSheetToCart = async () => {
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

      // Add gang sheet without image first
      const gangSheetItem = {
        id: Date.now(),
        name: "Gang Sheet",
        type: "gangsheet",
        image: "/placeholder-gangsheet.png",
        items: normalized,
        designSignature,
        price: headerInfo?.price || 0,
        widthIn: headerInfo?.widthIn || 24,
        heightIn: headerInfo?.heightIn || 19.5,
        size: `${(headerInfo?.widthIn || 24).toFixed(1)}" × ${(headerInfo?.heightIn || 19.5
        ).toFixed(1)}"`,
        copies: 1,
        color: "N/A",
        design: "Custom Gang Sheet",
        print: "DTF Transfer",
      };

      console.log("gangSheetItem being added:", gangSheetItem);
      console.log("gangSheetItem.items:", gangSheetItem.items);

      setCartItems((prev) => [...prev, gangSheetItem]);

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

  return (
    <div className="relative flex flex-col h-screen w-screen bg-white">
      <Header
        info={headerInfo ? { ...headerInfo, name: currentLoadedDesignTitle || headerInfo.name } : undefined}
        canRedo={!!lastAction}
        onMenuClick={() => setIsSidebarOpen(true)}
        onCartClick={() => setShowCheckoutModal(true)}
        cartCount={cartItems.length}
        onAddGangSheetToCart={handleAddGangSheetToCart}
        canAddGangSheetToCart={getCurrentItems().length > 0}
        isLoggedIn={isLoggedIn}
        canSaveLoaded={Boolean(currentLoadedDesignId && hasUnsavedChanges && !isGangsheetBusy)}
        canRenameDesign={Boolean(isLoggedIn && currentLoadedDesignId)}
        onProfileClick={() => {
          setShowAccountModal(true);
          setIsSidebarOpen(false);
        }}
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
          if (!currentLoadedDesignId) return;
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
        onRedo={() => {
          if (!lastAction) return;
          const sourceItems =
            (artboardData?.items as any[]) ||
            (loadedDesignData?.items as any[]) ||
            [];
          if (sourceItems.length === 0) return;
          if (lastAction.type === "delete") {
            const snapshot =
              lastAction.id != null ? deletedItems[lastAction.id] : null;
            if (!snapshot) return;
            const updated = [...sourceItems, snapshot];
            const nextData = { items: updated, counter: Date.now() };
            setArtboardData(nextData);
            setLoadedDesignData(nextData);
            setLastAction(null);
            return;
          }
          const idx = sourceItems.findIndex((it) => it.id === lastAction.id);
          if (idx === -1) return;
          const updated = [...sourceItems];
          const current = updated[idx];
          const it = { ...current };
          switch (lastAction.type) {
            case "rotate":
              it.rotation =
                ((it.rotation || 0) + (lastAction.payload?.delta || 90)) %
                360;
              break;
            case "flip":
              it.flipped = !it.flipped;
              break;
            case "toggleLock":
              it.locked = !it.locked;
              break;
            case "toggleLinked":
              it.linked = !it.linked;
              break;
            case "toggleExpand":
              it.expanded = !it.expanded;
              break;
            case "setCopies":
              it.copies = lastAction.payload?.value ?? it.copies;
              break;
            case "setWidthIn":
              it.widthIn = lastAction.payload?.value ?? it.widthIn;
              if (it.linked && it.heightIn) {
                const ratio =
                  current.heightIn / (current.widthIn || it.widthIn || 1);
                it.heightIn =
                  (lastAction.payload?.value ?? it.widthIn) * ratio;
              }
              break;
            case "setHeightIn":
              it.heightIn = lastAction.payload?.value ?? it.heightIn;
              if (it.linked && it.widthIn) {
                const ratio =
                  current.widthIn / (current.heightIn || it.heightIn || 1);
                it.widthIn =
                  (lastAction.payload?.value ?? it.heightIn) * ratio;
              }
              break;
            case "setPosX":
              it.posX = lastAction.payload?.value ?? it.posX;
              break;
            case "setPosY":
              it.posY = lastAction.payload?.value ?? it.posY;
              break;
            default:
              break;
          }
          updated[idx] = it;
          const nextData = { items: updated, counter: Date.now() };
          setArtboardData(nextData);
          setLoadedDesignData(nextData);
          setLastAction(null);
        }}
        onSaveLoaded={currentLoadedDesignId ? saveLoadedGangsheet : undefined}
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
        showRulers={settings.showRulers}
        showGrid={settings.showGrid}
        snapToGrid={settings.snapToGrid}
        showMargins={settings.showMargins}
        marginSize={settings.marginSize}
        autoNestStickers={settings.autoNestStickers}
        spacing={settings.spacing}
        onRequestAutoNest={(enabled) => {
          if (enabled) updateSetting("autoNestStickers", true);
        }}
        onDataChange={setArtboardData}
        initialData={loadedDesignData}
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
        onSignOut={() => {
          setIsLoggedIn(false);
          setUser(null);
          localStorage.removeItem("token");
          toast.success("Successfully signed out");
        }}
      />
      <SaveGangSheetModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        artboardData={artboardData}
        initialTitle={currentLoadedDesignTitle}
        onSave={async (title: string, thumbnail: string, data: any) => {
          if (!isLoggedIn) {
            setAuthView("login");
            setShowAuthModal(true);
            return;
          }

          const widthIn = headerInfo?.widthIn || 24;
          const heightIn = headerInfo?.heightIn || 19.5;
          const areaSqFt = headerInfo?.areaSf ?? (widthIn * heightIn) / 144;
          const price = headerInfo?.price ?? 0;

          const items = Array.isArray(data?.items) ? data.items : [];
          const normalizedItems = ensureUniqueItemIds(items);
          const mappedItems = normalizedItems.map((it: any) => ({
            id: it.id,
            assetId: it.originalUrl || it.assetId || it.url,
            croppedUrl:
              it.autoCrop !== false &&
              typeof it.url === "string" &&
              !it.url.startsWith("data:")
                ? it.url
                : undefined,
            widthIn: it.widthIn,
            heightIn: it.heightIn,
            posX: it.posX,
            posY: it.posY,
            rotation: it.rotation || 0,
            copies: it.copies || 1,
            linked: Boolean(it.linked),
            autoCrop: it.autoCrop !== false,
          }));

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
            toast.error(
              err?.message ||
                (currentLoadedDesignId
                  ? "Failed to update gangsheet"
                  : "Failed to save gangsheet"),
              toastId ? { id: toastId } : undefined,
            );
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
          setIsLoggedIn(false);
          setUser(null);
          localStorage.removeItem("token");
          toast.success("Successfully signed out");
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
        onViewDetails={(orderId) => {
          setSelectedOrderId(orderId);
          setShowOrderHistoryModal(false);
          setShowOrderDetailsModal(true);
        }}
      />
      <OrderDetailsModal
        isOpen={showOrderDetailsModal}
        onClose={() => {
          setShowOrderDetailsModal(false);
          setSelectedOrderId(null);
        }}
        orderId={selectedOrderId}
      />
      <CheckoutModal
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
