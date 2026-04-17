import { useRef, useState } from "react";
import { readDPI, loadImageSize } from "../utils";
import { animateBounce, animateShake, animateItemPosition } from "../utils";
import { calculateGridLayout } from "../utils";
import { ArtboardItem } from "../../types";
import { gsap } from "gsap";
import { CANVAS } from "../../../../config/artboard.config";
import toast from "react-hot-toast";

export const useDropHandler = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  counter: number,
  setCounter: React.Dispatch<React.SetStateAction<number>>,
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>,
  canvasWidth: number,
  zoom: number,
  autoNestStickers: boolean,
  onRequestAutoNest: ((enabled: boolean) => void) | undefined,
  spacing: number,
  marginSize: number
) => {
  const [isDragging, setIsDragging] = useState(false);
  const [lowDpiCount, setLowDpiCount] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  const activeUploadsRef = useRef<XMLHttpRequest[]>([]);
  const canceledRef = useRef(false);
  const warnedMaxHeightRef = useRef(false);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const cancelUploads = () => {
    canceledRef.current = true;
    activeUploadsRef.current.forEach((xhr) => {
      try {
        xhr.abort();
      } catch {
      }
    });
    activeUploadsRef.current = [];
    setIsUploading(false);
    setUploadProgress(0);
    setUploadFileName(null);
  };

  const uploadAssetWithProgress = (file: File, onProgress: (pct: number) => void) => {
    const API_BASE_URL = "http://localhost:4000/api";
    const token = localStorage.getItem("token");

    return new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeUploadsRef.current.push(xhr);

      xhr.open("POST", `${API_BASE_URL}/customer/assets`);
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          onProgress(Math.max(0, Math.min(100, (evt.loaded / evt.total) * 100)));
        }
      };

      xhr.onload = () => {
        activeUploadsRef.current = activeUploadsRef.current.filter((x) => x !== xhr);
        try {
          const json = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(json);
          else reject(new Error(json.message || "Upload failed"));
        } catch {
          reject(new Error("Upload failed"));
        }
      };

      xhr.onerror = () => {
        activeUploadsRef.current = activeUploadsRef.current.filter((x) => x !== xhr);
        reject(new Error("Upload failed"));
      };

      xhr.onabort = () => {
        activeUploadsRef.current = activeUploadsRef.current.filter((x) => x !== xhr);
        reject(new Error("Upload canceled"));
      };

      const formData = new FormData();
      formData.append("file", file);
      xhr.send(formData);
    });
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const processDrop = async ({
    droppedFiles,
    droppedUrl,
    dropX,
    dropY,
  }: {
    droppedFiles: File[];
    droppedUrl: string;
    dropX: number;
    dropY: number;
  }) => {
    setIsDragging(false);
    const dropped = droppedFiles;
    if (dropped.length === 0 && !droppedUrl) return;

    const cropImage = async (url: string, dpi: number) => {
      return new Promise<{
        url: string;
        widthIn: number;
        heightIn: number;
        widthPx: number;
        heightPx: number;
      } | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          let minX = canvas.width,
            minY = canvas.height,
            maxX = 0,
            maxY = 0;
          let found = false;

          const alphaThreshold = 10;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const alpha = data[(y * canvas.width + x) * 4 + 3];
              if (alpha > alphaThreshold) {
                found = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (!found) {
            resolve(null);
            return;
          }

          const cropWidth = maxX - minX + 1;
          const cropHeight = maxY - minY + 1;

          const croppedCanvas = document.createElement("canvas");
          const croppedCtx = croppedCanvas.getContext("2d");
          if (!croppedCtx) {
            resolve(null);
            return;
          }

          croppedCanvas.width = cropWidth;
          croppedCanvas.height = cropHeight;
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

          const croppedUrl = croppedCanvas.toDataURL("image/png");
          resolve({
            url: croppedUrl,
            widthPx: cropWidth,
            heightPx: cropHeight,
            widthIn: cropWidth / dpi,
            heightIn: cropHeight / dpi,
          });
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    };

    const start = counter + 1;
    let lowDpiImages = 0;

    const createItemFromUrl = async (
      url: string,
      idx: number,
      name?: string,
      dpiOverride?: number,
      originalUrlOverride?: string
    ) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const loaded = await new Promise<{ widthPx: number; heightPx: number }>((resolve, reject) => {
        img.onload = () => resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
        img.onerror = reject;
        img.src = url;
      });

      const dpi = Math.max(1, Math.round(dpiOverride || 300));
      const widthIn = loaded.widthPx / dpi;
      const heightIn = loaded.heightPx / dpi;

      const baseItem: ArtboardItem = {
        id: start + idx,
        url,
        rotation: 0,
        locked: false,
        expanded: false,
        flipped: false,
        autoCrop: true,
        copies: 1,
        widthIn,
        heightIn,
        posX: dropX - widthIn / 2,
        posY: dropY - heightIn / 2,
        linked: true,
        price: 12.34,
        name,
        gravityActive: false,
        isDropping: true,
        originalUrl: originalUrlOverride || url,
        originalWidthIn: widthIn,
        originalHeightIn: heightIn,
      };

      const cropped = await cropImage(url, dpi);
      if (cropped) {
        const deltaX = (widthIn - cropped.widthIn) / 2;
        const deltaY = (heightIn - cropped.heightIn) / 2;
        baseItem.url = cropped.url;
        baseItem.widthIn = cropped.widthIn;
        baseItem.heightIn = cropped.heightIn;
        baseItem.posX = baseItem.posX + deltaX;
        baseItem.posY = baseItem.posY + deltaY;
      }

      return baseItem;
    };

    let created: ArtboardItem[] = [];

    if (dropped.length > 0) {
      canceledRef.current = false;
      const uploadUiStart = Date.now();
      setIsUploading(true);
      setUploadProgress(0);
      setUploadFileName(dropped[0]?.name || null);
      await sleep(200);
      if (canceledRef.current) {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadFileName(null);
        return;
      }

      created = [];
      for (let idx = 0; idx < dropped.length; idx++) {
        if (canceledRef.current) {
          setIsUploading(false);
          setUploadProgress(0);
          setUploadFileName(null);
          return;
        }

        const file = dropped[idx];
        setUploadFileName(file.name);

        const [dpiInfo, localInfo] = await Promise.all([
          readDPI(file),
          loadImageSize(file),
        ]);

        let assetResponse: any = null;
        try {
          assetResponse = await uploadAssetWithProgress(file, (pct) => {
            const overall =
              ((idx + pct / 100) / dropped.length) * 100;
            setUploadProgress(Math.max(0, Math.min(100, overall)));
          });
        } catch (err: any) {
          if (canceledRef.current || err?.message === "Upload canceled") {
            setIsUploading(false);
            setUploadProgress(0);
            setUploadFileName(null);
            return;
          }
          assetResponse = null;
        }

        const dpi = Math.max(
          1,
          Math.round(assetResponse?.dpi || dpiInfo.dpiX || dpiInfo.dpiY || 300)
        );
        if (dpi < 300) lowDpiImages++;

        const serverUrl = assetResponse?.url || localInfo.url;
        const trimmedUrl = assetResponse?.trimmedUrl || null;
        const widthPx = assetResponse?.widthPx || localInfo.widthPx;
        const heightPx = assetResponse?.heightPx || localInfo.heightPx;

        const originalWidthIn = assetResponse?.widthIn || (widthPx / dpi);
        const originalHeightIn = assetResponse?.heightIn || (heightPx / dpi);
        const widthIn =
          (trimmedUrl ? assetResponse?.trimmedWidthIn : null) || originalWidthIn;
        const heightIn =
          (trimmedUrl ? assetResponse?.trimmedHeightIn : null) || originalHeightIn;

        const baseItem: ArtboardItem = {
          id: start + idx,
          url: trimmedUrl || serverUrl,
          rotation: 0,
          locked: false,
          expanded: false,
          flipped: false,
          autoCrop: true,
          copies: 1,
          widthIn,
          heightIn,
          posX: dropX - widthIn / 2,
          posY: dropY - heightIn / 2,
          linked: true,
          price: 12.34,
          name: file.name,
          gravityActive: false,
          isDropping: true,
          originalUrl: serverUrl,
          originalWidthIn,
          originalHeightIn,
        };

        if (!trimmedUrl) {
          const cropped = await cropImage(serverUrl, dpi);
          if (cropped) {
            const deltaX = (widthIn - cropped.widthIn) / 2;
            const deltaY = (heightIn - cropped.heightIn) / 2;
            baseItem.url = cropped.url;
            baseItem.widthIn = cropped.widthIn;
            baseItem.heightIn = cropped.heightIn;
            baseItem.posX = baseItem.posX + deltaX;
            baseItem.posY = baseItem.posY + deltaY;
          }
        }

        created.push(baseItem);
      }

      setUploadProgress(100);
      const elapsed = Date.now() - uploadUiStart;
      if (elapsed < 700) await sleep(700 - elapsed);
      setIsUploading(false);
      setUploadFileName(null);
    } else {
      let asset: any = null;
      try {
        asset = JSON.parse(droppedUrl);
      } catch {
      }

      const url = asset?.trimmedUrl || asset?.url || droppedUrl;
      const dpi = asset?.dpi;
      created = [
        await createItemFromUrl(
          url,
          0,
          asset?.originalFilename,
          dpi,
          asset?.url
        ),
      ];
    }

    if (lowDpiImages > 0) {
      setLowDpiCount(lowDpiImages);
      setTimeout(() => setLowDpiCount(0), 8000);
    }

    const autoNestForDrop = autoNestStickers || dropped.length >= 2;

    // 1. Calculate the final intended layout for ALL items immediately
    setTimeout(() => {
      // Always use the real sheet width (inches), not viewport width,
      // otherwise items can be laid out beyond the top ruler break (23.5").
      const currentCanvasWidth = canvasWidth || CANVAS.SHEET_WIDTH_IN;

      // Keep existing layout order first so newly uploaded items
      // flow into the next available (typically lower) slots.
      const allItems = [...items, ...created];
      const effectiveMargin = marginSize;

      const finalUpdatesRaw = calculateGridLayout(
        allItems,
        currentCanvasWidth,
        spacing,
        autoNestForDrop,
        effectiveMargin
      );

      // Enforce max sheet height (100 feet = 1200 inches).
      // Copies can wrap vertically, so clamp using a conservative
      // "worst-case" group height so items can never exceed the ruler bottom.
      const MAX_SHEET_HEIGHT_IN = 1200;
      let didClamp = false;
      const finalUpdates = finalUpdatesRaw.map((u: any) => {
        const itemH = typeof u.heightIn === "number" ? u.heightIn : 0;
        const copies = typeof u.copies === "number" && u.copies > 0 ? u.copies : 1;
        const gap = CANVAS.GRID_GAP_IN;
        const groupHeightIn = copies <= 1 ? itemH : copies * itemH + (copies - 1) * gap;
        const maxPosY = Math.max(0, MAX_SHEET_HEIGHT_IN - groupHeightIn);
        const nextPosY = Math.max(0, Math.min(u.posY, maxPosY));
        if (nextPosY !== u.posY) didClamp = true;
        return { ...u, posY: nextPosY };
      });

      if (didClamp && !warnedMaxHeightRef.current) {
        toast.error("Max sheet height of 1200 inches reached.");
        warnedMaxHeightRef.current = true;
      }

      // 2. Preserve NEW items at their drop position initially (avoid instant jump).
      setItems((prev) => {
        // Keep existing items first so newly dropped singles are arranged after them
        // (below grouped/copies items in the packed layout).
        const withCreated = [...prev, ...created];
        return withCreated.map((it) => {
          const isNew = created.some((c) => c.id === it.id);
          if (isNew) {
            return { ...it, gravityActive: false };
          }
          return it;
        });
      });

      // 3. Perform the physical interaction sequence
      setTimeout(() => {
        const PPI = CANVAS.PIXELS_PER_INCH;

        // Calculate items that need to be pushed
        const itemsToPush = finalUpdates.filter((u) => {
          const existing = items.find((ex) => ex.id === u.id);
          return (
            existing &&
            (Math.abs(u.posX - existing.posX) > 0.01 ||
              Math.abs(u.posY - existing.posY) > 0.01)
          );
        });

        const pushedIds = new Set(itemsToPush.map((p) => p.id));
        const newIds = new Set(created.map((c) => c.id));

        // A. CONTACT POINT: Trigger 'Physical Shove' quickly after contact
        gsap.delayedCall(0.2, () => {
          // 1. Update React state for ALL affected items at once
          setItems((prev) =>
            prev.map((it) => {
              const update = finalUpdates.find((u) => u.id === it.id);
              const isNew = newIds.has(it.id);
              if (isNew) return { ...it, isDropping: false };
              if (update && pushedIds.has(it.id)) {
                return {
                  ...it,
                  posX: update.posX,
                  posY: update.posY,
                  gravityActive: true,
                };
              }
              return it;
            })
          );

          // 2. Trigger staggered physical animations
          const sortedToPush = [...itemsToPush].sort((a, b) => {
            const indexA = finalUpdates.findIndex((u) => u.id === a.id);
            const indexB = finalUpdates.findIndex((u) => u.id === b.id);
            return indexA - indexB;
          });

          sortedToPush.forEach((u, index) => {
            const existing = items.find((ex) => ex.id === u.id);
            if (!existing) return;
            const el = document.querySelector(
              `[data-item-id="${u.id}"]`
            ) as HTMLElement;
            if (el) {
              gsap.delayedCall(index * 0.08, () => {
                animateItemPosition(
                  el,
                  u.posX,
                  u.posY,
                  true,
                  existing.posX,
                  existing.posY
                );
              });
            }
          });
        });

        // B. SETTLE POINT: Shake nearby items that WERE NOT pushed
        // Adjusted from 2.7 to 2.1 to match earlier push timing
        gsap.delayedCall(2.1, () => {
          finalUpdates.forEach((u) => {
            if (!pushedIds.has(u.id) && !newIds.has(u.id)) {
              const el = document.querySelector(
                `[data-item-id="${u.id}"]`
              ) as HTMLElement;
              if (el) animateShake(el);
            }
          });
        });

        // C. INDIVIDUAL ANIMATIONS FOR NEW ITEMS (smooth transition to top layout)
        created.forEach((item) => {
          const update = finalUpdates.find((u) => u.id === item.id);
          if (!update) return;

          const element = document.querySelector(
            `[data-item-id="${item.id}"]`
          ) as HTMLElement;
          if (!element) return;

          gsap.fromTo(
            element,
            {
              left: `${(dropX - item.widthIn / 2) * PPI}px`,
              top: `${(dropY - item.heightIn / 2) * PPI}px`,
              scale: 1.08,
              opacity: 0,
            },
            {
              left: `${update.posX * PPI}px`,
              top: `${update.posY * PPI}px`,
              scale: 1,
              opacity: 1,
              duration: 1.6,
              ease: "power2.out",
              immediateRender: true,
              onComplete: () => {
                // Commit final coordinates in React state
                setItems((prev) =>
                  prev.map((it) =>
                    it.id === item.id
                      ? {
                          ...it,
                          posX: update.posX,
                          posY: update.posY,
                          isDropping: false,
                        }
                      : it
                  )
                );
                animateBounce(element, update.posY);
              },
            }
          );
        });
      }, 50);
    }, 50);

    setCounter(start + dropped.length - 1);
    setSelectedId(null);
  };

  const onDropEvent = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith("image/")
    );
    const jsonData =
      e.dataTransfer.getData("application/json") ||
      e.dataTransfer.getData("text/plain");
    const droppedUrl = droppedFiles.length === 0 ? jsonData : "";
    if (droppedFiles.length === 0 && !droppedUrl) return;
    if (droppedFiles.length >= 2 && !autoNestStickers) {
      onRequestAutoNest?.(true);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const zoomVal = zoom || 1;
    const offset = CANVAS.RULER_OFFSET_PX;
    const ppi = CANVAS.PIXELS_PER_INCH;
    
    const dropX = (e.clientX - rect.left - offset) / (ppi * zoomVal);
    const dropY = (e.clientY - rect.top - offset) / (ppi * zoomVal);

    await processDrop({ droppedFiles, droppedUrl, dropX, dropY });
  };

  const dropFilesAtCenter = async (files: FileList | File[]) => {
    const arr = Array.isArray(files) ? files : Array.from(files);
    const droppedFiles = arr.filter((f) => f.type.startsWith("image/"));
    if (droppedFiles.length === 0) return;
    if (droppedFiles.length >= 2 && !autoNestStickers) {
      onRequestAutoNest?.(true);
    }

    const currentCanvasWidth = canvasWidth || CANVAS.SHEET_WIDTH_IN;
    const dropX = currentCanvasWidth / 2;
    const dropY = 6;
    await processDrop({ droppedFiles, droppedUrl: "", dropX, dropY });
  };

  return {
    isDragging,
    lowDpiCount,
    isUploading,
    uploadProgress,
    uploadFileName,
    cancelUploads,
    dropFilesAtCenter,
    onDragOver,
    onDragLeave,
    onDropEvent,
  };
};
