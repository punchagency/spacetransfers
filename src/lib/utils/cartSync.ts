import { billableSheetDimensions, getPricePerSqFt, getSheetWidthIn } from "./pricingRates";

/**
 * The cart across devices and sessions.
 *
 * A signed-in customer's cart is kept on their account (`/customer/cart`). It
 * used to be sent on every change, silently dropped by the server (the field was
 * missing from the user schema) and never read back, so it followed nobody
 * anywhere. Because the browser's own copy drops embedded artwork to fit in
 * storage, the account copy is also the only complete one.
 *
 * Nothing ties a signed-out cart to a person: it joins whichever account signs
 * in on this browser, and the sign-in message says so (`cartSignInMessage`).
 *
 * The rules, in one place:
 *  - signing in loads the account's cart and merges in anything added while
 *    signed out; a cart left in the browser by a different account is replaced,
 *    never merged;
 *  - nothing is written to the account until its cart has been read, so opening
 *    the store on a new device cannot overwrite the saved cart with an empty one;
 *  - signing out clears the browser's copy (the account keeps it); a session that
 *    merely expired keeps it, since the same person is still at the keyboard;
 *  - placing an order clears both (the server clears the account's copy itself).
 */

/** Which account the cart in this browser belongs to, or null for a guest cart. */
const OWNER_KEY = "cartOwner";

export const readCartOwner = (): string | null => {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
};

export const writeCartOwner = (userId: string | null) => {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    /* storage unavailable: the merge simply treats the cart as a guest cart */
  }
};

/**
 * Identity of a cart line. A sheet added from the editor carries a signature of
 * its contents, which is what "the same sheet" means; other lines (reorders)
 * have only their id.
 */
export const cartLineKey = (line: any): string =>
  line?.designSignature ? `sig:${line.designSignature}` : `id:${line?.id}`;

/**
 * The account's cart with the browser's lines added after it, minus duplicates.
 * Account lines come first and win a tie: they are the complete copy, with
 * artwork references the browser's copy may have dropped.
 */
export const mergeCarts = (accountCart: any[], browserCart: any[]): any[] => {
  const merged = [...accountCart];
  const seen = new Set(accountCart.map(cartLineKey));
  for (const line of browserCart) {
    const key = cartLineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }
  return merged;
};

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/**
 * What signing in did to the cart, or null when it changed nothing worth saying.
 * `restored`: lines that came back from the account. `addedAsGuest`: lines added
 * while signed out, now saved to the account — named so someone on a shared
 * computer notices items that are not theirs.
 */
export const cartSignInMessage = (restored: number, addedAsGuest: number): string | null => {
  if (restored > 0 && addedAsGuest > 0) {
    return `Your cart has ${items(restored)} from your saved cart and ${items(addedAsGuest)} you added while signed out.`;
  }
  if (restored > 0) {
    return `${items(restored)} from your saved cart ${restored === 1 ? "was" : "were"} added back.`;
  }
  if (addedAsGuest > 0) {
    return `${items(addedAsGuest)} you added while signed out ${addedAsGuest === 1 ? "is" : "are"} now saved to your account.`;
  }
  return null;
};

const SIZE_EPSILON_IN = 0.005;

/**
 * A gang sheet line priced at today's settings — the same rule the server
 * charges with (roll width × at least the minimum length × rate) — so the cart
 * shows the total the card is charged.
 *
 * The line's width is never changed. A sheet laid out on a roll that has since
 * been resized is left as it is: checkout refuses it and tells the customer to
 * re-fit it, and rewriting its width here would slip it past that check onto a
 * roll its placements do not fit.
 *
 * Returns the same object when nothing changes, so callers can tell.
 */
export const repriceCartLine = <T extends Record<string, any>>(line: T): T => {
  if ((line?.type || "gangsheet") !== "gangsheet") return line;
  const widthIn = Number(line.widthIn);
  const heightIn = Number(line.heightIn);
  if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn) || heightIn <= 0) return line;
  if (Math.abs(widthIn - getSheetWidthIn()) > SIZE_EPSILON_IN) return line;

  const billed = billableSheetDimensions(heightIn);
  const price = +(billed.areaSf * getPricePerSqFt()).toFixed(2);
  if (Math.abs((line.price ?? 0) - price) < 0.005 && Math.abs(heightIn - billed.heightIn) < SIZE_EPSILON_IN) {
    return line;
  }
  return {
    ...line,
    price,
    heightIn: billed.heightIn,
    size: `${billed.widthIn.toFixed(1)}" × ${billed.heightIn.toFixed(1)}"`,
  };
};

/** Every line re-priced; the same array when nothing changed. */
export const repriceCart = <T extends Record<string, any>>(cart: T[]): T[] => {
  let changed = false;
  const next = cart.map((line) => {
    const priced = repriceCartLine(line);
    if (priced !== line) changed = true;
    return priced;
  });
  return changed ? next : cart;
};
