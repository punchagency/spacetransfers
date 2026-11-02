import { useSyncExternalStore } from "react";

/*
 * Where the selected image's own settings are shown in the Settings panel.
 *
 * The panel and the image live in different subtrees, and the settings need
 * the image's live handlers. So the panel offers a place, and the selected
 * image renders its settings into it — the same fields as its right-click
 * panel, from the same component.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Ref callback for the element in the Settings panel. */
export const registerSelectedImageSlot = (el: HTMLElement | null) => {
  if (slot === el) return;
  slot = el;
  listeners.forEach((notify) => notify());
};

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

/** The element to render into, or null while the Settings panel is closed. */
export const useSelectedImageSlot = (): HTMLElement | null =>
  useSyncExternalStore(subscribe, () => slot, () => null);
