import { ArtboardItem } from "../../types";
import { CANVAS, DPI, MAX_SHEET_HEIGHT_IN } from "../../../../config/artboard.config";
import {
  computeEffectiveDpi,
  computeRenderCopies,
  flipGroupHorizontally,
  getItemFootprint,
  isSheetFull,
  resolveDragPlacement,
  rotateGroupClockwise,
} from "../utils/layoutHelpers";
import { autoCropImage } from "../utils/autoCrop";
import { afterPixelEdit, uncroppedSourceOf } from "../utils/imageState";
import { readImageInfo } from "../utils/imageUtils";
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

/** What a BG-removal or DPI run over the selection did, for the summary toast. */
export interface PixelBatchResult {
  /** Images changed. */
  done: number;
  /** Images that did not need it (already transparent / already 300 DPI). */
  skipped: number;
  /** Locked images left alone. */
  locked: number;
  failed: number;
  firstError?: string;
}

export const useItemActions = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  selectedId: number | null,
  /** Everything selected. Toolbar actions apply to all of it, not just the piece last clicked. */
  selectedIds: ReadonlySet<number>,
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

  /**
   * The pieces an action applies to: everything selected, the clicked one first.
   *
   * Toolbar actions used to touch `selectedId` alone, so with three pieces
   * selected — all showing handles — Delete removed one of them and left two.
   */
  const targetIds = (): number[] => {
    const ids = selectedId == null ? [] : [selectedId];
    for (const id of selectedIds) if (id !== selectedId) ids.push(id);
    return ids.filter((id) => items.some((it) => it.id === id));
  };

  /**
   * A locked piece is fully locked: it cannot be moved, resized, turned,
   * flipped, edited or deleted until it is unlocked. Lock used to stop dragging
   * and nothing else, so a "locked" piece still rotated, took a typed width and
   * went on being editable.
   */
  const UNLOCK_TO_EDIT = "This image is locked. Unlock it to make changes.";
  const isLocked = (id: number | null) => id != null && Boolean(items.find((it) => it.id === id)?.locked);

  /** Targets that may be changed, with a note when locked ones were left alone. */
  const editableTargets = (): number[] => {
    const all = targetIds();
    const editable = all.filter((id) => !isLocked(id));
    if (all.length > 0 && editable.length === 0) toast.error(UNLOCK_TO_EDIT, { id: "locked" });
    else if (editable.length < all.length) {
      const kept = all.length - editable.length;
      toast(`${kept} locked ${kept === 1 ? "image was" : "images were"} left unchanged.`, { id: "locked", icon: "🔒" });
    }
    return editable;
  };

  /** Guards a single-piece action (typed size, crop, copies, BG, DPI) against the lock. */
  const blockedByLock = () => {
    if (!isLocked(selectedId)) return false;
    toast.error(UNLOCK_TO_EDIT, { id: "locked" });
    return true;
  };

  /**
   * Splits the pieces an action applies to into whole groups and loose pieces.
   * A group is only acted on as one when every member is part of the action —
   * selecting a member selects its group, so in practice that is always.
   */
  const splitUnits = (ids: Set<number>) => {
    const groups = new Map<string, ArtboardItem[]>();
    const loose = new Set<number>();
    for (const it of items) {
      if (!ids.has(it.id)) continue;
      if (it.groupId) {
        const list = groups.get(it.groupId) ?? [];
        list.push(it);
        groups.set(it.groupId, list);
      } else loose.add(it.id);
    }
    for (const [groupId, members] of groups) {
      const whole = items.filter((it) => it.groupId === groupId).length === members.length;
      if (!whole || members.length < 2) {
        for (const m of members) loose.add(m.id);
        groups.delete(groupId);
      }
    }
    return { groups: [...groups.values()], loose };
  };

  /** Applies a whole-group transform to each group, replacing its members in place. */
  const applyToGroups = (
    prev: ArtboardItem[],
    groups: ArtboardItem[][],
    transform: (members: ArtboardItem[]) => ArtboardItem[],
  ) => {
    const replaced = new Map<number, ArtboardItem>();
    for (const members of groups) {
      for (const m of transform(members)) replaced.set(m.id, { ...m, gravityActive: !m.pinned });
    }
    return prev.map((it) => replaced.get(it.id) ?? it);
  };

  const rotateSelected = () => {
    const targets = new Set(editableTargets());
    if (targets.size === 0) return;
    const { groups, loose: ids } = splitUnits(targets);
    commit();
    setItems((prev) =>
      applyToGroups(prev, groups, (members) => rotateGroupClockwise(members, canvasWidth, marginSize, spacing)).map((it) => {
        if (!ids.has(it.id)) return it;
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
      id: selectedId ?? undefined,
      payload: { delta: 90 },
    });
  };

  /** Locks everything selected; if everything already is, unlocks it all. */
  const toggleLockSelected = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    const lock = ids.some((id) => !isLocked(id));
    const set = new Set(ids);
    commit();
    setItems((prev) => prev.map((it) => (set.has(it.id) ? { ...it, locked: lock } : it)));
    emit({ type: "toggleLock", id: selectedId ?? undefined });
  };

  const flipSelected = () => {
    const targets = new Set(editableTargets());
    if (targets.size === 0) return;
    const { groups, loose: ids } = splitUnits(targets);
    commit();
    setItems((prev) =>
      applyToGroups(prev, groups, (members) => flipGroupHorizontally(members, canvasWidth, marginSize, spacing)).map(
        (it) => (ids.has(it.id) ? { ...it, flipped: !it.flipped } : it),
      ),
    );
    emit({ type: "flip", id: selectedId ?? undefined });
  };

  /**
   * Auto crop on or off for the selected piece, keeping its scale either way.
   *
   * It works from the piece's uncropped image (`uncroppedSourceOf`), which every
   * edit updates. Working from the upload instead undid edits: a background
   * removed and then auto-crop turned off brought the background back.
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
    if (selectedId == null || blockedByLock()) return;
    const id = selectedId;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const source = uncroppedSourceOf(item);
    if (!source) return;

    const oddQuarter = ((Math.round((item.rotation || 0) / 90) % 2) + 2) % 2 === 1;
    const [currentPx, original] = await Promise.all([
      item.croppedWidthPx || item.nativeWidthPx
        ? Promise.resolve(item.croppedWidthPx || item.nativeWidthPx || 0)
        : naturalSizeOf(item.url).then((size) => size?.w ?? 0),
      item.uncroppedUrl === source && item.uncroppedWidthPx && item.uncroppedHeightPx
        ? Promise.resolve({ w: item.uncroppedWidthPx, h: item.uncroppedHeightPx })
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
                uncroppedUrl: source,
                uncroppedWidthPx: original.w,
                uncroppedHeightPx: original.h,
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
        const recorded = { ...it, uncroppedUrl: source, uncroppedWidthPx: original.w, uncroppedHeightPx: original.h };
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
    if (selectedId == null || blockedByLock()) return;
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
    if (selectedId == null || blockedByLock()) return;
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
    if (selectedId == null || blockedByLock()) return;
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
    if (selectedId == null || blockedByLock()) return;
    const id = selectedId;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const fp = getItemFootprint(item, canvasWidth, marginSize, spacing);
    const raw = snapToGrid ? snapToGridPoint(n) : n;
    const value =
      axis === "posX"
        ? Math.min(Math.max(raw, marginSize), Math.max(marginSize, canvasWidth - marginSize - fp.w))
        : Math.min(Math.max(raw, marginSize), Math.max(marginSize, MAX_SHEET_HEIGHT_IN - fp.h));
    if (Math.abs(value - item[axis]) < 1e-6) return;

    // A grouped piece takes its group with it: members keep their places.
    const moving = item.groupId ? items.filter((it) => it.groupId === item.groupId) : [item];
    const movingIds = new Set(moving.map((it) => it.id));
    const delta = value - item[axis];
    const projected = items.map((it) => (movingIds.has(it.id) ? { ...it, [axis]: it[axis] + delta } : it));
    const { moves, valid } = resolveDragPlacement(
      projected,
      [...movingIds],
      canvasWidth,
      marginSize,
      spacing,
      new Map(moving.map((it) => [it.id, { posX: it.posX, posY: it.posY }])),
    );
    if (!valid) {
      toast.error("That position overlaps other artwork. Try a clear spot.");
      return;
    }

    commit(`${axis === "posX" ? "setPosX" : "setPosY"}-${id}`);
    setItems((prev) =>
      prev.map((it) => {
        if (movingIds.has(it.id)) return { ...it, [axis]: it[axis] + delta, pinned: true };
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

  /**
   * Runs a pixel edit over every selected, unlocked image, one after another,
   * so several images can be cleaned up in one click. `needsIt` inspects an
   * image and says whether the edit applies; `run` does it and hands the
   * result to `apply`. The whole run is one undo step (history is committed
   * once, just before the first change lands), and one image failing does not
   * stop the rest.
   */
  const runPixelBatch = async (
    needsIt: (it: ArtboardItem) => Promise<boolean>,
    run: (it: ArtboardItem, label: string, apply: (update: (it: ArtboardItem) => ArtboardItem) => void) => Promise<void>,
  ): Promise<PixelBatchResult> => {
    const all = targetIds();
    const locked = all.filter((id) => isLocked(id)).length;
    if (all.length > 0 && locked === all.length) throw new Error(UNLOCK_TO_EDIT);
    const result: PixelBatchResult = { done: 0, skipped: 0, locked, failed: 0 };

    const queue: ArtboardItem[] = [];
    for (const id of all) {
      const it = items.find((x) => x.id === id);
      if (!it || it.locked) continue;
      if (await needsIt(it)) queue.push(it);
      else result.skipped += 1;
    }

    let committed = false;
    for (let i = 0; i < queue.length; i++) {
      const target = queue[i];
      const label = queue.length > 1 ? `Image ${i + 1} of ${queue.length} · ` : "";
      const apply = (update: (it: ArtboardItem) => ArtboardItem) => {
        if (!committed) { commit(); committed = true; }
        setItems((prev) => prev.map((it) => (it.id === target.id ? update(it) : it)));
      };
      try {
        await run(target, label, apply);
        result.done += 1;
      } catch (err) {
        result.failed += 1;
        result.firstError ??= err instanceof Error ? err.message : String(err);
      }
    }
    return result;
  };

  /** Removes the background from every selected image that has one. */
  const removeBg = async (onProgress?: (phase: string, pct: number) => void) => {
    const { removeBackgroundAI } = await import("../utils/bgRemover");
    return runPixelBatch(
      async (it) => (await readImageInfo(it.url))?.hasBackground ?? true,
      async (item, label, apply) => {
        const result = await removeBackgroundAI(item.url, (phase, pct) => onProgress?.(label + phase, pct));
        apply((it) => {
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
            // The full-resolution cutout is shown, printed, and becomes the
            // uncropped source, with its real pixel counts so DPI stays truthful.
            ...afterPixelEdit(result.dataUrl, result.widthPx, result.heightPx),
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
        });
        emit({ type: "removeBg", id: item.id });
      },
    );
  };

  /** Deletes everything selected except locked pieces. Returns how many went. */
  const deleteSelected = (): number => {
    const ids = new Set(editableTargets());
    if (ids.size === 0) return 0;
    commit();
    const removed = items.filter((it) => ids.has(it.id));
    setItems((prev) => prev.filter((it) => !ids.has(it.id)));
    for (const snapshot of removed) {
      emit({ type: "delete", id: snapshot.id, payload: { item: snapshot } });
    }
    return ids.size;
  };

  /**
   * Effective DPI of an image at its current print size, measured from the
   * loaded pixels (as the item's own badge does), falling back to stored sizes.
   */
  const measuredDpi = async (it: ArtboardItem): Promise<number | null> => {
    const info = await readImageInfo(it.url);
    const rotOdd = ((Math.round((it.rotation ?? 0) / 90) % 2) + 2) % 2 === 1;
    const widthAxisIn = rotOdd ? it.heightIn : it.widthIn;
    if (info && widthAxisIn > 0) return Math.round(info.widthPx / widthAxisIn);
    return computeEffectiveDpi(it);
  };

  /**
   * Upscales every selected image that prints below 300 DPI, each by the
   * factor it needs to reach 300 at its current size (2x–8x). Images already
   * at 300 or more are left alone.
   */
  const increaseDpi = async (onProgress?: (phase: string) => void) => {
    const { upscaleImageAI } = await import("../utils/upscaler");
    const dpiOf = new Map<number, number | null>();
    return runPixelBatch(
      async (it) => {
        const dpi = await measuredDpi(it);
        dpiOf.set(it.id, dpi);
        // Unknown DPI is offered the enhancer too — the badge flags it as a risk.
        return dpi == null || dpi < DPI.THRESHOLD;
      },
      async (item, label, apply) => {
        onProgress?.(label + "Enhancing…");
        const current = dpiOf.get(item.id) || 72;
        const scale = Math.min(8, Math.max(2, Math.ceil(DPI.THRESHOLD / current)));
        const result = await upscaleImageAI(item.url, scale);
        apply((it) => {
          // Physical placement is unchanged — only the image source and DPI
          // metadata are updated so the item stays in place on the artboard.
          // At odd rotations the image's width axis is displayed along heightIn
          // (rotateSelected swaps the dims), so measure against that axis.
          const rotOdd = ((Math.round((it.rotation ?? 0) / 90) % 2) + 2) % 2 === 1;
          const widthAxisIn = rotOdd ? it.heightIn : it.widthIn;
          const newDpi = widthAxisIn > 0 ? Math.round(result.widthPx / widthAxisIn) : DPI.THRESHOLD;
          return {
            ...it,
            // Shown, printed (checkout sends croppedUrl), and the new uncropped
            // source — without all three the print or a later crop toggle would
            // go back to the lower-resolution image.
            ...afterPixelEdit(result.upscaledUrl, result.widthPx, result.heightPx),
            dpi: newDpi,
            originalUrl: it.originalUrl || it.url,
          };
        });
        emit({ type: "increaseDpi", id: item.id, payload: { scale: result.scale, widthPx: result.widthPx } });
      },
    );
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
