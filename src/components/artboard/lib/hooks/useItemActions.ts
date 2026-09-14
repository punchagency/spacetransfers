import { ArtboardItem } from "../../types";
import { apiFetch } from "../../../../lib/utils/api";
import { CANVAS, MAX_SHEET_HEIGHT_IN } from "../../../../config/artboard.config";
import { computeRenderCopies, getItemFootprint, isSheetFull, resolveDragPlacement } from "../utils/layoutHelpers";
import { autoCropImage } from "../utils/autoCrop";
import { canvasToLocalUrl } from "../utils/imageUtils";
import type { CommitHistory } from "./useHistory";
import toast from "react-hot-toast";

/** Natural pixel size of an image, or null when it cannot be loaded. */
const naturalSizeOf = (url: string) =>
  new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () =>
      resolve(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });

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

  /**
   * Auto crop on or off for the selected piece, keeping its scale either way.
   *
   * Three faults in the old toggle, each confirmed in the browser:
   *   - turning it off swapped the image shown but left `croppedUrl` — the copy
   *     the print is made from — as the cropped image, so the order printed the
   *     crop stretched to the uncropped size, and the stale pixel count flagged
   *     the piece at 76dpi;
   *   - both directions snapped the piece back to its upload size, discarding
   *     any resize (set to 10in, it came back at 1.67in);
   *   - turning it on ran a second, older copy of the crop at full resolution on
   *     the main thread, cutting 500px where the upload had cut 504.
   *
   * Scale is carried through as inches per image pixel along the image's own
   * width axis, which a quarter turn leaves alone.
   */
  const toggleAutoCrop = async () => {
    if (selectedId == null) return;
    const id = selectedId;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const source = item.originalUrl || item.url;
    if (!source) return;

    const oddQuarter = ((Math.round((item.rotation || 0) / 90) % 2) + 2) % 2 === 1;
    const [currentPx, original] = await Promise.all([
      item.croppedWidthPx || item.nativeWidthPx
        ? Promise.resolve(item.croppedWidthPx || item.nativeWidthPx || 0)
        : naturalSizeOf(item.url).then((size) => size?.w ?? 0),
      item.originalWidthPx && item.originalHeightPx
        ? Promise.resolve({ w: item.originalWidthPx, h: item.originalHeightPx })
        : naturalSizeOf(source),
    ]);
    if (!currentPx || !original) {
      toast.error("This image could not be re-read to change its crop. Please try again.");
      return;
    }

    const inchesPerPx = (oddQuarter ? item.heightIn : item.widthIn) / currentPx;
    // The new size, re-centred on where the piece was, so it does not jump.
    const resizedTo = (it: ArtboardItem, wPx: number, hPx: number) => {
      const widthIn = (oddQuarter ? hPx : wPx) * inchesPerPx;
      const heightIn = (oddQuarter ? wPx : hPx) * inchesPerPx;
      return {
        widthIn,
        heightIn,
        posX: it.posX + (it.widthIn - widthIn) / 2,
        posY: Math.max(0, it.posY + (it.heightIn - heightIn) / 2),
      };
    };
    commit();

    if (item.autoCrop) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                autoCrop: false,
                url: source,
                // The print is made from croppedUrl, so it follows the image shown.
                croppedUrl: source,
                croppedWidthPx: original.w,
                croppedHeightPx: original.h,
                nativeWidthPx: original.w,
                originalUrl: source,
                originalWidthPx: original.w,
                originalHeightPx: original.h,
                ...resizedTo(it, original.w, original.h),
              }
            : it,
        ),
      );
      emit({ type: "toggleAutoCrop", id });
      return;
    }

    // On straight away, so the switch answers the click; the crop follows.
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, autoCrop: true } : it)));
    // The same crop uploads use. The DPI argument only sizes its own result,
    // which is not used — the piece keeps the scale computed above.
    const cropped = await autoCropImage(source, 300);
    setItems((prev) =>
      prev.map((it) => {
        // Switched off again while the crop ran: leave it off.
        if (it.id !== id || !it.autoCrop) return it;
        const recorded = { ...it, originalUrl: source, originalWidthPx: original.w, originalHeightPx: original.h };
        // Nothing around the artwork to trim: the image is already its own crop.
        if (!cropped) return recorded;
        return {
          ...recorded,
          url: cropped.url,
          croppedUrl: cropped.url,
          croppedWidthPx: cropped.widthPx,
          croppedHeightPx: cropped.heightPx,
          nativeWidthPx: cropped.widthPx,
          ...resizedTo(it, cropped.widthPx, cropped.heightPx),
        };
      }),
    );
    emit({ type: "toggleAutoCrop", id });
  };

  const toggleLinked = () => {
    if (selectedId == null) return;
    commit();
    setItems((prev) => {
      const item = prev.find((it) => it.id === selectedId);
      if (!item) return prev;

      // Locks proportions only. With copies it used to split the group into
      // separate images instead, under the same Link/Unlink label.
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

  /**
   * Moves the selected piece to a typed position, the way a drop does.
   *
   * A typed position used to be written as-is. It could sit on top of other
   * artwork, which prints as overlapping ink, or past the printable width, where
   * the artboard drew it clamped but the export used the raw number. It is now
   * clamped to the sheet and checked like a drag: neighbours in the way move
   * aside if they can, and a spot that cannot be cleared is refused.
   */
  const moveSelected = (axis: "posX" | "posY", n: number) => {
    if (selectedId == null) return;
    const id = selectedId;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const fp = getItemFootprint(item, canvasWidth, marginSize, spacing);
    const raw = snapToGrid ? snapToGridPoint(n) : n;
    const value =
      axis === "posX"
        ? Math.min(Math.max(raw, marginSize), Math.max(marginSize, canvasWidth - marginSize - fp.w))
        : Math.min(Math.max(raw, 0), Math.max(0, MAX_SHEET_HEIGHT_IN - fp.h));
    if (Math.abs(value - item[axis]) < 1e-6) return;

    const projected = items.map((it) => (it.id === id ? { ...it, [axis]: value } : it));
    const { moves, valid } = resolveDragPlacement(
      projected,
      [id],
      canvasWidth,
      marginSize,
      spacing,
      new Map([[id, { posX: item.posX, posY: item.posY }]]),
    );
    if (!valid) {
      toast.error("That position overlaps other artwork. Try a clear spot.");
      return;
    }

    commit(`${axis === "posX" ? "setPosX" : "setPosY"}-${id}`);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === id) return { ...it, [axis]: value, pinned: true };
        const mv = moves.get(it.id);
        return mv ? { ...it, posX: mv.posX, posY: mv.posY, pinned: true } : it;
      }),
    );
    emit({ type: axis === "posX" ? "setPosX" : "setPosY", id, payload: { value } });
  };

  const setPosX = (n: number) => moveSelected("posX", n);
  const setPosY = (n: number) => moveSelected("posY", n);

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
