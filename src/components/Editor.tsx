import { useState } from "react";
import Header from "./Header";
import Artboard from "./Artboard";
import Sidebar from "./Sidebar";
import SaveGangSheetModal from "./modals/SaveGangSheetModal";
import LoadGangSheetModal from "./modals/LoadGangSheetModal";
import AccountSettingsModal from "./modals/AccountSettingsModal";
import OrderHistoryModal from "./modals/OrderHistoryModal";
import OrderDetailsModal from "./modals/OrderDetailsModal";
import CheckoutModal from "./modals/CheckoutModal";
import { captureArtboard } from "./artboard/lib/utils";

export default function Editor() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showOrderHistoryModal, setShowOrderHistoryModal] = useState(false);
  const [showOrderDetailsModal, setShowOrderDetailsModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
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
      id: number;
      title: string;
      time: string;
      size: string;
      thumbnail: string;
      data?: any;
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
        size: `${(headerInfo?.widthIn || 24).toFixed(1)}" × ${(
          headerInfo?.heightIn || 19.5
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
        info={headerInfo}
        canRedo={!!lastAction}
        onMenuClick={() => setIsSidebarOpen(true)}
        onCartClick={() => setShowCheckoutModal(true)}
        cartCount={cartItems.length}
        onAddGangSheetToCart={handleAddGangSheetToCart}
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
          setShowSaveModal(true);
          setIsSidebarOpen(false);
        }}
        onOpenLoadModal={() => {
          setShowLoadModal(true);
          setIsSidebarOpen(false);
        }}
        onOpenAccountModal={() => {
          setShowAccountModal(true);
          setIsSidebarOpen(false);
        }}
      />
      <SaveGangSheetModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        artboardData={artboardData}
        onSave={(title: string, thumbnail: string, data: any) => {
          const newDesign = {
            id: Date.now(),
            title,
            time: "Just now",
            size: '24" × 19.5"',
            thumbnail,
            data,
          };
          setSavedDesigns((prev) => [newDesign, ...prev]);
          setShowSaveModal(false);
        }}
      />
      <LoadGangSheetModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        designs={savedDesigns}
        onLoad={(id) => {
          const design = savedDesigns.find((d) => d.id === id);
          if (design && design.data) {
            setLoadedDesignData(design.data);
            setShowLoadModal(false);
          }
        }}
        onRename={(id, newTitle) => {
          setSavedDesigns((prev) =>
            prev.map((d) => (d.id === id ? { ...d, title: newTitle } : d))
          );
        }}
        onDuplicate={(id) => {
          const design = savedDesigns.find((d) => d.id === id);
          if (design) {
            const newDesign = {
              ...design,
              id: Date.now(),
              title: `${design.title} (Copy)`,
              time: "Just now",
            };
            setSavedDesigns((prev) => [newDesign, ...prev]);
          }
        }}
        onDelete={(id) => {
          setSavedDesigns((prev) => prev.filter((d) => d.id !== id));
        }}
      />
      <AccountSettingsModal
        isOpen={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        onOpenOrderHistory={() => {
          setShowAccountModal(false);
          setShowOrderHistoryModal(true);
        }}
        onViewOrderDetails={() => {
          setShowAccountModal(false);
          setShowOrderDetailsModal(true);
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
    </div>
  );
}
