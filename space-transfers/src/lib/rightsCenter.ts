import type { ImageRights } from "./utils/rights";

/**
 * Opens the rights reviews panel from anywhere: an upload the check stopped,
 * an image on the board, checkout, or the account menu.
 */
export interface RightsCenterRequest {
  reason?: "upload" | "board" | "checkout" | "menu";
  images?: ImageRights[];
}

const EVENT = "st:rights-center";

export const openRightsCenter = (request: RightsCenterRequest = {}) => {
  window.dispatchEvent(new CustomEvent<RightsCenterRequest>(EVENT, { detail: request }));
};

export const onRightsCenterRequest = (handler: (request: RightsCenterRequest) => void) => {
  const listener = (e: Event) => handler((e as CustomEvent<RightsCenterRequest>).detail || {});
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
