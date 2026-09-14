import { ArtboardItem } from "../../types";
import { apiFetch } from "../../../../lib/utils/api";
import { CANVAS, MAX_SHEET_HEIGHT_IN } from "../../../../config/artboard.config";
import { computeRenderCopies, isSheetFull } from "../utils/layoutHelpers";
import { canvasToLocalUrl } from "../utils/imageUtils";
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
      prev.map((it) => {
        if (it.id !== selectedId) return it;
        // Each 90° step swaps the visual footprint so the bounding box always
        // matches the rotated orientation. originalWidth/Height are swapped too
        // so autoCrop restore remains consistent after rotation.
        return {
          ...it,
          rotation: (it.rotation + 90) % 360,
          widthIn: it.heightIn,
          heightIn: it.widthIn,
          originalWidthIn: it.originalHeightIn,
          originalHeightIn: it.originalWidthIn,
          gravityActive: !it.pinned,
        };
      })
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

      // Canvas fallback: works for both transparent PNGs and solid-background images.
      // Operates at the image's native pixel dimensions (img.width = img.naturalWidth
      // for a non-DOM Image) so the crop is always at original upload resolution.
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width  = img.width;
        canvas.height = img.height;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
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

        croppedCanvas.width  = cropWidth;
        croppedCanvas.height = cropHeight;
        croppedCtx.imageSmoothingEnabled = true;
        croppedCtx.imageSmoothingQuality = "high";
        // 1:1 native-pixel crop — no resampling, lossless source fidelity
        croppedCtx.drawImage(img, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        /**
         * Lossless PNG at native resolution, held as bytes rather than as text.
         *
         * `toDataURL` encodes synchronously on the main thread and returns a
         * base64 string 4/3 the size of the pixels, which then sits in the
         * JavaScript heap until every reference to it goes — and references to
         * an item's `url` reach React state, undo history and the cart. On a
         * full-resolution crop that froze the UI for the whole encode and cost
         * megabytes that were slow to come back.
         *
         * `canvasToLocalUrl` moves the encode off the main thread via
         * `toBlob`, so the UI no longer stalls for the duration. The result is
         * still a `data:` URL, which is what keeps it on the upload path:
         * `useMaterializeImages` uploads it to Cloudinary moments later and
         * swaps in a short hosted URL, so nothing large survives to the cart.
         */
        const croppedImageUrl = await canvasToLocalUrl(croppedCanvas, "image/png");

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
                  // croppedUrl is the dedicated export URL — full-res canvas PNG at
                  // native pixel dimensions, separate from `url` (display URL).
                  croppedUrl: croppedImageUrl,
                  // Store the canvas output pixel dimensions so the server DPI calculator
                  // uses the ACTUAL cropped pixel count (cropWidth) instead of the DB's
                  // widthPx (the larger pre-crop original), preventing upscaling.
                  croppedWidthPx: cropWidth,
                  croppedHeightPx: cropHeight,
                  nativeWidthPx: cropWidth,
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
    if (clamped > current.copies && isSheetFull(items as any)) {
      toast.error(
        `Sheet is full — the maximum length of ${MAX_SHEET_HEIGHT_IN.toLocaleString()}in has been reached. Remove artwork before adding more copies.`,
      );
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

  /**
   * No printable-width guard.
   *
   * This used to refuse any value wider than the printable area and show an
   * error. Both halves were wrong: the customer had typed a deliberate number,
   * and rejecting it outright left the field showing one value while the item
   * kept another. Oversized artwork is now allowed everywhere — it is reported
   * by the artboard banner on upload, and sizing beyond the sheet is a choice
   * the customer is entitled to make while laying out.
   */
  const setWidthIn = (n: number) => {
    if (selectedId == null) return;
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

  // Same reasoning as setWidthIn: a linked height that implies an oversized
  // width is permitted rather than rejected.
  const setHeightIn = (n: number) => {
    if (selectedId == null) return;
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
      prev.map((it) =>
        it.id === selectedId
          ? { ...it, posX: finalX, pinned: true }
          : it
      )
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
      prev.map((it) =>
        it.id === selectedId
          ? { ...it, posY: finalY, pinned: true }
          : it
      )
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

    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== selectedId) return it;
        // The cutout is trimmed to the subject's bounding box, so the box
        // shrinks by the trim ratio while the SUBJECT keeps its exact
        // physical print size and stays centered where it was — nothing
        // visually jumps or rescales. At odd rotations widthIn/heightIn are
        // swapped relative to the image's own axes (see rotateSelected), so
        // the trim ratios are applied along the correct axis.
        const rotOdd = ((Math.round((it.rotation ?? 0) / 90) % 2) + 2) % 2 === 1;
        const scaleW = result.originalWidthPx > 0 ? result.widthPx / result.originalWidthPx : 1;
        const scaleH = result.originalHeightPx > 0 ? result.heightPx / result.originalHeightPx : 1;
        const newWidthIn = it.widthIn * (rotOdd ? scaleH : scaleW);
        const newHeightIn = it.heightIn * (rotOdd ? scaleW : scaleH);
        return {
          ...it,
          url: result.dataUrl,
          // croppedUrl = full-resolution BG-removed PNG (bgRemover runs at
          // img.naturalWidth × img.naturalHeight — the original upload resolution).
          // Stored separately from `url` so the export pipeline never reads from
          // a CSS-scaled or compressed intermediate; it gets the raw canvas output.
          croppedUrl: result.dataUrl,
          // Actual pixel dimensions of the cutout, measured by bgRemover —
          // not approximated from a possibly-stale dpi × widthIn product —
          // so DPI calculations (client warnings and the server compositor)
          // stay truthful after removal.
          croppedWidthPx: result.widthPx,
          croppedHeightPx: result.heightPx,
          nativeWidthPx: result.widthPx,
          widthIn: newWidthIn,
          heightIn: newHeightIn,
          posX: it.posX + (it.widthIn - newWidthIn) / 2,
          posY: it.posY + (it.heightIn - newHeightIn) / 2,
          // originalUrl must stay as the pre-removal Cloudinary URL so the
          // checkout assetId resolves to the original DB record, not a data URL.
          originalUrl: it.originalUrl || it.url,
          originalWidthIn: it.widthIn,
          originalHeightIn: it.heightIn,
          autoCrop: true,
        };
      })
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

  const increaseDpi = async (scale = 2) => {
    if (selectedId == null) return;
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;

    const { upscaleImageAI } = await import("../utils/upscaler");
    const result = await upscaleImageAI(item.url, Math.max(2, Math.round(scale)));

    commit(`increaseDpi-${selectedId}`);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== selectedId) return it;
        // Physical placement is unchanged — only the image source and DPI
        // metadata are updated so the item stays in place on the artboard.
        // At odd rotations the image's width axis is displayed along heightIn
        // (rotateSelected swaps the dims), so measure against that axis.
        const rotOdd = ((Math.round((it.rotation ?? 0) / 90) % 2) + 2) % 2 === 1;
        const widthAxisIn = rotOdd ? it.heightIn : it.widthIn;
        const newDpi = widthAxisIn > 0 ? Math.round(result.widthPx / widthAxisIn) : 300;
        return {
          ...it,
          url: result.upscaledUrl,
          dpi: newDpi,
          nativeWidthPx: result.widthPx,
          // croppedUrl/croppedWidthPx are what checkout actually sends to the
          // print pipeline for server-side DPI — without updating these too,
          // the upscale would only affect the on-canvas preview and the final
          // printed file would still use the old, lower-resolution source.
          croppedUrl: result.upscaledUrl,
          croppedWidthPx: result.widthPx,
          croppedHeightPx: result.heightPx,
          originalUrl: it.originalUrl || it.url,
        };
      }),
    );
    emit({ type: "increaseDpi", id: selectedId, payload: { scale: result.scale, widthPx: result.widthPx } });
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
