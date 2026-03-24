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
import { captureArtboard } from "./artboard/lib/utils";
import { apiFetch } from "../lib/utils/api";

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
  const [cartItems, setCartItems] = useState<any[]>([]);
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

  const getDesignSnapshot = (items: any[]) => {
    if (!Array.isArray(items)) return "[]";
    return JSON.stringify(items.map((it: any) => ({
      assetId: it.originalUrl || it.assetId || it.url,
      widthIn: Math.round((it.widthIn || 0) * 1000) / 1000,
      heightIn: Math.round((it.heightIn || 0) * 1000) / 1000,
      posX: Math.round((it.posX || 0) * 1000) / 1000,
      posY: Math.round((it.posY || 0) * 1000) / 1000,
      rotation: it.rotation || 0,
      copies: it.copies || 1,
      linked: Boolean(it.linked),
    })));
  };

  const hasUnsavedChanges = currentLoadedDesignId != null &&
    getDesignSnapshot(artboardData?.items || []) !== currentLoadedDesignString;

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
    spacing: 0.25,
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
      // Prevent adding duplicate gang sheet to cart
      const existingGangSheet = cartItems.find(
        (item) => item.type === "gangsheet"
      );
      if (existingGangSheet) {
        setCartWarning("This gang sheet has already been added to your cart.");
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
        items: artboardData?.items || [],
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
        isLoggedIn={isLoggedIn}
        canSaveLoaded={hasUnsavedChanges}
        canRenameDesign={Boolean(isLoggedIn && currentLoadedDesignId)}
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
        onSaveLoaded={
          currentLoadedDesignId
            ? async () => {
              const items = Array.isArray(artboardData?.items)
                ? artboardData.items
                : Array.isArray(loadedDesignData?.items)
                  ? loadedDesignData.items
                  : [];
              const normalizedItems = ensureUniqueItemIds(items);
              const mappedItems = normalizedItems.map((it: any) => ({
                id: it.id,
                assetId: it.originalUrl || it.assetId || it.url,
                widthIn: it.widthIn,
                heightIn: it.heightIn,
                posX: it.posX,
                posY: it.posY,
                rotation: it.rotation || 0,
                copies: it.copies || 1,
                linked: Boolean(it.linked),
              }));

              try {
                let thumbnail;
                try {
                  thumbnail = await captureArtboard();
                } catch (err) {
                  console.warn("Could not capture thumbnail:", err);
                }

                await apiFetch(`/customer/designs/${currentLoadedDesignId}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    ...(thumbnail ? { thumbnail } : {}),
                    artboardData: { items: mappedItems },
                  }),
                });
                toast.success(
                  `Saved "${(currentLoadedDesignTitle || "Gang Sheet").trim()}"`,
                );

                // Keep the current design loaded and update snapshot baseline
                const newSnapshot = getDesignSnapshot(normalizedItems);
                setCurrentLoadedDesignString(newSnapshot);
                setLoadedDesignData({ items: normalizedItems as any[], counter: Date.now() });
                setArtboardData({ items: normalizedItems as any[], counter: Date.now() });

                // Update the designs list to reflect the new snapshot
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

                setCurrentLoadedDesignId(null);
                setCurrentLoadedDesignString(null);
                setCurrentLoadedDesignTitle(null);
                setArtboardData({ items: [], counter: Date.now() });
                setLoadedDesignData({ items: [], counter: Date.now() });
              } catch (err) {
                toast.error("Failed to save gangsheet");
              }
            }
            : undefined
        }
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
        onDataChange={setArtboardData}
        initialData={loadedDesignData}
        onAddToCart={(item) => setCartItems((prev) => [...prev, item])}
      />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        settings={settings}
        onUpdateSetting={updateSetting}
        onOpenSaveModal={() => {
          if (!isLoggedIn) {
            setAuthView("login");
            setShowAuthModal(true);
            setIsSidebarOpen(false);
            return;
          }
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
          setArtboardData({ items: [], counter: Date.now() });
          setLoadedDesignData({ items: [], counter: Date.now() });
          setCurrentLoadedDesignId(null);
          setCurrentLoadedDesignString(null);
          setCurrentLoadedDesignTitle(null);
          setLastAction(null);
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
            widthIn: it.widthIn,
            heightIn: it.heightIn,
            posX: it.posX,
            posY: it.posY,
            rotation: it.rotation || 0,
            copies: it.copies || 1,
            linked: Boolean(it.linked),
          }));

          try {
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
              setCurrentLoadedDesignString(getDesignSnapshot(normalizedItems));
              toast.success(`Saved "${title.trim() || "Gang Sheet"}"`);
              updateSavedDesignSnapshot(currentLoadedDesignId, {
                title,
                thumbnail,
                time: formatDesignTime(new Date().toISOString()),
              });
              setCurrentLoadedDesignId(null);
              setCurrentLoadedDesignString(null);
              setCurrentLoadedDesignTitle(null);
              setArtboardData({ items: [], counter: Date.now() });
              setLoadedDesignData({ items: [], counter: Date.now() });
            } else {
              await apiFetch("/customer/designs", {
                method: "POST",
                body: JSON.stringify({
                  title,
                  thumbnail,
                  size: { widthIn, heightIn },
                  pricing: { areaSqFt, price },
                  artboardData: { items: mappedItems },
                }),
              });
              toast.success("Design saved");
            }
            setShowSaveModal(false);
            fetchDesigns();
          } catch {
            toast.error(
              currentLoadedDesignId
                ? "Failed to update gangsheet"
                : "Failed to save gangsheet",
            );
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
        onLoad={async (id) => {
          const res = await apiFetch(`/customer/designs/${id}`);
          const items = Array.isArray(res?.artboardData?.items)
            ? res.artboardData.items
            : [];

          const mappedItems = ensureUniqueItemIds(
            items.map((it: any) => ({
            id: it.id,
            url: it.assetId,
            rotation: it.rotation || 0,
            locked: false,
            expanded: false,
            flipped: false,
            autoCrop: false,
            copies: it.copies || 1,
            widthIn: it.widthIn,
            heightIn: it.heightIn,
            posX: it.posX,
            posY: it.posY,
            linked: Boolean(it.linked),
            price: 0,
          })),
          );

          setLoadedDesignData({ items: mappedItems, counter: Date.now() });
          setCurrentLoadedDesignId(id);
          setCurrentLoadedDesignString(getDesignSnapshot(mappedItems));
          setCurrentLoadedDesignTitle(res?.title || null);
          setShowLoadModal(false);
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
        onViewDetails={() => {
          setShowOrderHistoryModal(false);
          setShowOrderDetailsModal(true);
        }}
      />
      <OrderDetailsModal
        isOpen={showOrderDetailsModal}
        onClose={() => setShowOrderDetailsModal(false)}
      />
      <CheckoutModal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        cartItems={cartItems}
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
