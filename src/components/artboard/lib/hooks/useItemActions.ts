import { ArtboardItem } from "../../types";
import { apiFetch } from "../../../../lib/utils/api";
import { CANVAS } from "../../../../config/artboard.config";
import { computeRenderCopies } from "../utils/layoutHelpers";
import type { CommitHistory } from "./useHistory";
import toast from "react-hot-toast";

const DPI_STEP = 50;
const DPI_MAX = 600;

export const useItemActions = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  selectedId: number | null,
  snapToGrid: boolean,
  snapToGridPoint: (value: number) => number,
  canvasWidth: number,
  marginSize: number,
  spacing: number,
  onActionPerformed?: (action: {
    type: string;
    id?: number;
    payload?: any;
  }) => void,
  commitHistory?: CommitHistory,
) => {
  const emit = (action: { type: string; id?: number; payload?: any }) => {
    setTimeout(() => {
      onActionPerformed?.(action);
    }, 0);
  };
  const commit = (tag?: string) => commitHistory?.(tag);

  const rotateSelected = () => {
    if (selectedId == null) return;
    commit();
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId
          ? { ...it, rotation: (it.rotation + 90) % 360 }
          : it
      )
    );
    emit({
      type: "rotate",
      id: selectedId,
      payload: { delta: 90 },
    });
  };

  const toggleLockSelected = () => {
    if (selectedId == null) return;
    commit();
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, locked: !it.locked } : it
      )
    );
    emit({ type: "toggleLock", id: selectedId });
  };

  const flipSelected = () => {
    if (selectedId == null) return;
    commit();
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, flipped: !it.flipped } : it
      )
    );
    emit({ type: "flip", id: selectedId });
  };

  const toggleAutoCrop = async () => {
    if (selectedId == null) return;
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;
    commit();

    if (!item.autoCrop) {
      // Optimistic update: flip toggle immediately so UI responds at once
      setItems((prev) =>
        prev.map((it) => (it.id === selectedId ? { ...it, autoCrop: true } : it))
      );

      const sourceUrl = (item.originalUrl || item.url) as string;

      if (
        typeof sourceUrl === "string" &&
        sourceUrl.includes("/uploads/") &&
        !sourceUrl.includes("-trim.png")
      ) {
        try {
          const trimmed = await apiFetch("/customer/assets/trim", {
            method: "POST",
            body: JSON.stringify({ url: sourceUrl }),
          });
          if (trimmed?.trimmedUrl) {
            setItems((prev) =>
              prev.map((it) =>
                it.id === selectedId
                  ? {
                      ...it,
                      autoCrop: true,
                      url: trimmed.trimmedUrl,
                      widthIn: trimmed.trimmedWidthIn || it.widthIn,
                      heightIn: trimmed.trimmedHeightIn || it.heightIn,
                      originalUrl: it.originalUrl || it.url,
                      originalWidthIn: it.originalWidthIn || it.widthIn,
                      originalHeightIn: it.originalHeightIn || it.heightIn,
                    }
                  : it
              )
            );
            emit({ type: "toggleAutoCrop", id: selectedId });
            return;
          }
        } catch {
        }
      }

      // Canvas fallback: works for both transparent PNGs and solid-background images
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const w = canvas.width;
        const h = canvas.height;

        // Check if ANY pixel has transparency (not just corners)
        let hasTransparency = false;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 250) { hasTransparency = true; break; }
        }

        let minX = w, minY = h, maxX = -1, maxY = -1;
        let found = false;

        if (hasTransparency) {
          // Alpha-based: tight bounding box of non-transparent pixels
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (data[(y * w + x) * 4 + 3] > 10) {
                found = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
        } else {
          // Sample the full border strip (~2% of the shorter side) for background color
          const borderW = Math.max(2, Math.round(Math.min(w, h) * 0.02));
          let sumR = 0, sumG = 0, sumB = 0, count = 0;

          for (let y = 0; y < borderW; y++) {
            for (let x = 0; x < w; x++) {
              let i = (y * w + x) * 4;
              sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
              i = ((h - 1 - y) * w + x) * 4;
              sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
            }
          }
          for (let x = 0; x < borderW; x++) {
            for (let y = borderW; y < h - borderW; y++) {
              let i = (y * w + x) * 4;
              sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
              i = (y * w + (w - 1 - x)) * 4;
              sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
            }
          }

          const bgR = count > 0 ? sumR / count : 255;
          const bgG = count > 0 ? sumG / count : 255;
          const bgB = count > 0 ? sumB / count : 255;
          const colorThreshold = 30;

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const dr = data[i] - bgR;
              const dg = data[i + 1] - bgG;
              const db = data[i + 2] - bgB;
              if (Math.sqrt(dr * dr + dg * dg + db * db) > colorThreshold) {
                found = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
        }

        if (!found) {
          emit({ type: "toggleAutoCrop", id: selectedId });
          return;
        }

        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;

        const croppedCanvas = document.createElement("canvas");
        const croppedCtx = croppedCanvas.getContext("2d");
        if (!croppedCtx) return;

        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        croppedCtx.drawImage(img, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        const croppedImageUrl = croppedCanvas.toDataURL("image/png");

        const originalWidthIn = item.originalWidthIn || item.widthIn;
        const dpi = Math.max(1, Math.round(img.width && originalWidthIn ? img.width / originalWidthIn : 300));
        const newWidthIn = cropWidth / dpi;
        const newHeightIn = cropHeight / dpi;

        setItems((prev) =>
          prev.map((it) =>
            it.id === selectedId
              ? {
                  ...it,
                  autoCrop: true,
                  widthIn: newWidthIn,
                  heightIn: newHeightIn,
                  url: croppedImageUrl,
                  originalUrl: it.originalUrl || it.url,
                  originalWidthIn: it.originalWidthIn || it.widthIn,
                  originalHeightIn: it.originalHeightIn || it.heightIn,
                }
              : it
          )
        );
        emit({ type: "toggleAutoCrop", id: selectedId });
      };
      img.onerror = () => {
        emit({ type: "toggleAutoCrop", id: selectedId });
      };
      img.src = sourceUrl;
    } else {
      // Restore original image and dimensions
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedId
            ? {
                ...it,
                autoCrop: false,
                url: it.originalUrl || it.url,
                widthIn: it.originalWidthIn || it.widthIn,
                heightIn: it.originalHeightIn || it.heightIn,
              }
            : it
        )
      );
      emit({ type: "toggleAutoCrop", id: selectedId });
    }
  };

  const toggleLinked = () => {
    if (selectedId == null) return;
    commit();
    setItems((prev) => {
      const item = prev.find((it) => it.id === selectedId);
      if (!item) return prev;

      // If item has copies, ungroup them instead of toggling aspect ratio link
      if (item.copies > 1) {
        const newItems: ArtboardItem[] = [];
        const cols = Math.ceil(Math.sqrt(item.copies));
        const gap = 0.05; // 4.8px ≈ 0.05 inches

        for (let i = 0; i < item.copies; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);

          const xOffset = col * (item.widthIn + gap);
          const yOffset = row * (item.heightIn + gap);

          // The first item (i=0) keeps the original ID, others get new IDs
          const newItem = {
            ...item,
            id: i === 0 ? item.id : Date.now() + i,
            copies: 1,
            posX: item.posX + xOffset,
            posY: item.posY + yOffset,
            // Ensure they are selected or handled correctly?
            // Maybe deselect or select all? For now just place them.
          };
          newItems.push(newItem);
        }

        // Replace the original item (and any others) with the new list
        // Filter out original, then add all new
        return [...prev.filter((it) => it.id !== selectedId), ...newItems];
      }

      // Default behavior: toggle aspect ratio link
      return prev.map((it) =>
        it.id === selectedId ? { ...it, linked: !it.linked } : it
      );
    });
    emit({ type: "toggleLinked", id: selectedId });
  };

  const setCopies = (n: number) => {
    if (selectedId == null) return;
    const current = items.find((it) => it.id === selectedId);
    if (!current) return;
    const requested = Math.max(1, Math.floor(n));
    const maxFit = computeRenderCopies(
      { ...current, copies: requested },
      canvasWidth,
      marginSize,
      spacing,
    );
    const clamped = Math.min(requested, maxFit);
    if (clamped > current.copies && items.length >= CANVAS.MAX_ITEMS) {
      toast.error(`Item limit of ${CANVAS.MAX_ITEMS} reached. Remove items before adding more copies.`);
      return;
    }
    if (clamped === current.copies) return;
    commit(`setCopies-${selectedId}`);
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, copies: clamped, gravityActive: true, skipAnimation: true } : it
      )
    );
    emit({
      type: "setCopies",
      id: selectedId,
      payload: { value: clamped },
    });
  };

  const setWidthIn = (n: number) => {
    if (selectedId == null) return;
    const maxPrintableWidth = canvasWidth - 2 * marginSize;
    if (n > maxPrintableWidth) {
      toast.error("Image width cannot exceed the printable area of the film after margins are applied.");
      return;
    }
    commit(`setWidthIn-${selectedId}`);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === selectedId) {
          if (it.linked) {
            const ratio = it.heightIn / it.widthIn;
            return { ...it, widthIn: n, heightIn: n * ratio, gravityActive: true };
          }
          return { ...it, widthIn: n, gravityActive: true };
        }
        return it;
      })
    );
    emit({
      type: "setWidthIn",
      id: selectedId,
      payload: { value: n },
    });
  };

  const setHeightIn = (n: number) => {
    if (selectedId == null) return;
    const current = items.find((it) => it.id === selectedId);
    if (current?.linked && current.heightIn > 0) {
      const ratio = current.widthIn / current.heightIn;
      const resultingWidth = n * ratio;
      const maxPrintableWidth = canvasWidth - 2 * marginSize;
      if (resultingWidth > maxPrintableWidth) {
        toast.error("Image width cannot exceed the printable area of the film after margins are applied.");
        return;
      }
    }
    commit(`setHeightIn-${selectedId}`);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === selectedId) {
          if (it.linked) {
            const ratio = it.widthIn / it.heightIn;
            return { ...it, heightIn: n, widthIn: n * ratio, gravityActive: true };
          }
          return { ...it, heightIn: n, gravityActive: true };
        }
        return it;
      })
    );
    emit({
      type: "setHeightIn",
      id: selectedId,
      payload: { value: n },
    });
  };

  const setPosX = (n: number) => {
    if (selectedId == null) return;
    commit(`setPosX-${selectedId}`);
    const finalX = snapToGrid ? snapToGridPoint(n) : n;
    setItems((prev) =>
      prev.map((it) => (it.id === selectedId ? { ...it, posX: finalX } : it))
    );
    emit({
      type: "setPosX",
      id: selectedId,
      payload: { value: finalX },
    });
  };

  const setPosY = (n: number) => {
    if (selectedId == null) return;
    commit(`setPosY-${selectedId}`);
    const finalY = snapToGrid ? snapToGridPoint(n) : n;
    setItems((prev) =>
      prev.map((it) => (it.id === selectedId ? { ...it, posY: finalY } : it))
    );
    emit({
      type: "setPosY",
      id: selectedId,
      payload: { value: finalY },
    });
  };

  const toggleExpandSelected = () => {
    if (selectedId == null) return;
    commit();
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, expanded: !it.expanded } : it
      )
    );
    emit({ type: "toggleExpand", id: selectedId });
  };

  const removeBg = async (onProgress?: (phase: string, pct: number) => void) => {
    if (selectedId == null) return;
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;
    commit();

    const { removeBackgroundAI } = await import("../utils/bgRemover");
    const result = await removeBackgroundAI(item.url, onProgress);

    // Preserve physical size: derive DPI from original pixel width vs inch width
    const dpi =
      result.originalWidthPx > 0 && item.widthIn > 0
        ? result.originalWidthPx / item.widthIn
        : 300;
    const newWidthIn = result.widthPx / dpi;
    const newHeightIn = result.heightPx / dpi;

    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId
          ? {
              ...it,
              url: result.dataUrl,
              widthIn: newWidthIn,
              heightIn: newHeightIn,
              // Make the BG-removed result the new baseline so that toggling
              // Auto Crop off doesn't restore the original white-background image.
              originalUrl: result.dataUrl,
              originalWidthIn: newWidthIn,
              originalHeightIn: newHeightIn,
              autoCrop: true,
            }
          : it
      )
    );
    emit({ type: "removeBg", id: selectedId });
  };

  const deleteSelected = () => {
    if (selectedId == null) return;
    commit();
    setItems((prev) => {
      const snapshot = prev.find((it) => it.id === selectedId);
      const next = prev.filter((it) => it.id !== selectedId);
      if (snapshot) {
        emit({
          type: "delete",
          id: selectedId,
          payload: { item: snapshot },
        });
      } else {
        emit({ type: "delete", id: selectedId });
      }
      return next;
    });
  };

  const increaseDpi = () => {
    if (selectedId == null) return;
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;

    const currentDpi = Math.max(1, Math.round(item.dpi || 300));
    // Below print-ready threshold: jump straight to 300 in a single click.
    // At or above 300: incremental +50 boosts for fine-tuning.
    const newDpi =
      currentDpi < 300
        ? 300
        : Math.min(currentDpi + DPI_STEP, DPI_MAX);
    if (newDpi <= currentDpi) {
      toast("Already at maximum DPI.", { icon: "ℹ️" });
      return;
    }

    commit(`increaseDpi-${selectedId}`);

    // DPI is purely a metadata/quality field — the item's widthIn, heightIn,
    // posX, and posY are deliberately untouched so the canvas layout stays put.
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, dpi: newDpi } : it,
      ),
    );

    emit({
      type: "increaseDpi",
      id: selectedId,
      payload: { from: currentDpi, to: newDpi },
    });
  };

  return {
    rotateSelected,
    toggleLockSelected,
    flipSelected,
    toggleAutoCrop,
    toggleLinked,
    setCopies,
    setWidthIn,
    setHeightIn,
    setPosX,
    setPosY,
    toggleExpandSelected,
    deleteSelected,
    removeBg,
    increaseDpi,
  };
};
