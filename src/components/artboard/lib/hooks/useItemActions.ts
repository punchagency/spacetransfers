import { ArtboardItem } from "../../types";

export const useItemActions = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  selectedId: number | null,
  snapToGrid: boolean,
  snapToGridPoint: (value: number) => number,
  onActionPerformed?: (action: {
    type: string;
    id?: number;
    payload?: any;
  }) => void
) => {
  const emit = (action: { type: string; id?: number; payload?: any }) => {
    setTimeout(() => {
      onActionPerformed?.(action);
    }, 0);
  };

  const rotateSelected = () => {
    if (selectedId == null) return;
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
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, locked: !it.locked } : it
      )
    );
    emit({ type: "toggleLock", id: selectedId });
  };

  const flipSelected = () => {
    if (selectedId == null) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, flipped: !it.flipped } : it
      )
    );
    emit({ type: "flip", id: selectedId });
  };

  const toggleAutoCrop = () => {
    if (selectedId == null) return;
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;

    if (!item.autoCrop) {
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

        let minX = canvas.width,
          minY = canvas.height,
          maxX = 0,
          maxY = 0;

        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const alpha = data[(y * canvas.width + x) * 4 + 3];
            if (alpha > 10) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;

        // Create a new canvas with the cropped dimensions
        const croppedCanvas = document.createElement("canvas");
        const croppedCtx = croppedCanvas.getContext("2d");
        if (!croppedCtx) return;

        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;

        // Draw only the cropped portion
        croppedCtx.drawImage(
          img,
          minX,
          minY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight
        );

        // Convert to data URL
        const croppedImageUrl = croppedCanvas.toDataURL("image/png");

        const dpi = Math.max(1, Math.round(150));
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
      };
      img.src = item.url;
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
    }
    emit({ type: "toggleAutoCrop", id: selectedId });
  };

  const toggleLinked = () => {
    if (selectedId == null) return;

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
    const clamped = Math.max(1, Math.min(250, Math.floor(n)));
    setItems((prev) =>
      prev.map((it) => (it.id === selectedId ? { ...it, copies: clamped } : it))
    );
    emit({
      type: "setCopies",
      id: selectedId,
      payload: { value: clamped },
    });
  };

  const setWidthIn = (n: number) => {
    if (selectedId == null) return;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === selectedId) {
          if (it.linked) {
            const ratio = it.heightIn / it.widthIn;
            return { ...it, widthIn: n, heightIn: n * ratio };
          }
          return { ...it, widthIn: n };
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
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === selectedId) {
          if (it.linked) {
            const ratio = it.widthIn / it.heightIn;
            return { ...it, heightIn: n, widthIn: n * ratio };
          }
          return { ...it, heightIn: n };
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
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId ? { ...it, expanded: !it.expanded } : it
      )
    );
    emit({ type: "toggleExpand", id: selectedId });
  };

  const deleteSelected = () => {
    if (selectedId == null) return;
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
  };
};
