import { billableSheetDimensions, getPricePerSqFt, getSheetWidthIn } from "./pricingRates";

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
 * Identity of a cart line. A gang sheet is its saved sheet (`designId`): one
 * saved sheet, one line. Lines from before lines recorded their sheet fall back
 * to a signature of their contents; other lines (reorders) have only their id.
 */
export const cartLineKey = (line: any): string =>
  line?.designId
    ? `design:${line.designId}`
    : line?.designSignature
    ? `sig:${line.designSignature}`
    : `id:${line?.id}`;

export const dedupeCartByDesign = <T extends Record<string, any>>(lines: T[]): T[] => {
  const newest = new Map<string, T>();
  for (const line of lines) {
    if ((line?.type || "gangsheet") !== "gangsheet" || !line?.designId) continue;
    const key = String(line.designId);
    const current = newest.get(key);
    if (!current || Number(line.id) > Number(current.id)) newest.set(key, line);
  }
  const kept = lines.filter(
    (line) =>
      (line?.type || "gangsheet") !== "gangsheet" || !line?.designId || newest.get(String(line.designId)) === line,
  );
  return kept.length === lines.length ? lines : kept;
};

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
