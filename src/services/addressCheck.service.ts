import { isEasyPostConfigured, verifyAddress, type DeliveryVerification } from "./easypost.service.js";

/**
 * Checks a shipping address with the carrier before the customer pays.
 *
 * A mistyped ZIP code still gets a price, just the wrong one, and the parcel
 * goes astray later. So checkout asks EasyPost whether it can deliver to the
 * address and shows the customer the carrier's correction, or tells them it
 * couldn't find the address at all. The customer decides; the order records
 * what they decided, so the admin and the partner see an address the carrier
 * didn't confirm before a label is bought.
 */

export interface AddressFields {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Why the carrier couldn't confirm an address, in terms a customer can act on. */
export type NotFoundReason = "missing_unit" | "invalid_unit" | "house_number" | "not_found";

export type AddressCheck =
  | { status: "verified" }
  | { status: "suggested"; suggestion: AddressFields; changed: (keyof AddressFields)[] }
  | { status: "not_found"; reason: NotFoundReason }
  | { status: "unavailable" };

/** What the order keeps: the check of the address the customer finally sent. */
export interface OrderAddressCheck {
  status: "verified" | "differs" | "not_found" | "unchecked";
  /** The carrier's version, when the customer kept their own. */
  suggestion?: string;
  reason?: NotFoundReason;
}

// Words USPS abbreviates; either spelling means the same street.
const STREET_WORDS: Record<string, string> = {
  AVENUE: "AVE", STREET: "ST", ROAD: "RD", BOULEVARD: "BLVD", DRIVE: "DR", LANE: "LN", COURT: "CT",
  PLACE: "PL", TERRACE: "TER", PARKWAY: "PKWY", HIGHWAY: "HWY", CIRCLE: "CIR", SQUARE: "SQ", TRAIL: "TRL",
  EXPRESSWAY: "EXPY", FREEWAY: "FWY", ALLEY: "ALY", CROSSING: "XING", POINT: "PT", MOUNT: "MT",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};
// "Apt 4", "Unit 4", "# 4" and "Ste 4" all name the same door.
const UNIT_WORDS = new Set(["APT", "APARTMENT", "UNIT", "STE", "SUITE", "#", "NO", "NUMBER", "RM", "ROOM"]);

const words = (s: string) =>
  s
    .toUpperCase()
    .replace(/#/g, " # ")
    .replace(/[^A-Z0-9# ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const streetKey = (s: string) =>
  words(s)
    .map((w) => STREET_WORDS[w] ?? w)
    .filter((w) => !UNIT_WORDS.has(w))
    .join(" ");

const zip5 = (z: string) => String(z || "").trim().slice(0, 5);

/** The carrier's upper-case address, written the way a person would. */
const titleWord = (w: string) => {
  if (/^(N|S|E|W|NE|NW|SE|SW|PO)$/.test(w)) return w;
  if (/^\d+(ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
  if (/\d/.test(w)) return w;
  return w.charAt(0) + w.slice(1).toLowerCase();
};
const titleCase = (s: string) => s.split(/\s+/).filter(Boolean).map(titleWord).join(" ");

export const formatAddress = (a: AddressFields) => `${a.street}, ${a.city}, ${a.state} ${a.postalCode}`;

/**
 * The carrier's verdict on what the customer typed. Only the street, state and
 * ZIP code decide where a parcel goes; the city is left out of the comparison
 * because USPS accepts several names for one ZIP code ("Hollywood" for Los
 * Angeles) and asking about those would only be noise.
 */
export const toAddressCheck = (entered: AddressFields, v: DeliveryVerification | null): AddressCheck => {
  if (!v) return { status: "unavailable" };
  if (!v.deliverable) {
    const codes = v.errorCodes.join(" ");
    const reason: NotFoundReason = /SECONDARY_INFORMATION\.MISSING/.test(codes)
      ? "missing_unit"
      : /SECONDARY_INFORMATION/.test(codes)
        ? "invalid_unit"
        : /HOUSE_NUMBER/.test(codes)
          ? "house_number"
          : "not_found";
    return { status: "not_found", reason };
  }
  const suggestion: AddressFields = {
    street: titleCase([v.address.street1, v.address.street2].filter(Boolean).join(" ")),
    city: titleCase(v.address.city),
    state: v.address.state.toUpperCase(),
    postalCode: zip5(v.address.zip),
  };
  if (!suggestion.street || !suggestion.state || !suggestion.postalCode) return { status: "unavailable" };
  // What really differs, not how it's spelled: "Avenue" and "Ave" are the same street.
  const changed = (["street", "city", "state", "postalCode"] as const).filter((field) =>
    field === "street"
      ? streetKey(entered.street) !== streetKey(suggestion.street)
      : field === "city"
        ? words(entered.city).join(" ") !== words(suggestion.city).join(" ")
        : field === "state"
          ? entered.state.trim().toUpperCase() !== suggestion.state
          : zip5(entered.postalCode) !== suggestion.postalCode,
  );
  const deciding = changed.filter((field) => field !== "city");
  return deciding.length === 0 ? { status: "verified" } : { status: "suggested", suggestion, changed };
};

// Each answer is kept for a while, so going back and forth through checkout
// asks the carrier once, and the order can read the verdict without asking again.
const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map<string, { check: AddressCheck; at: number }>();

const keyOf = (a: AddressFields) =>
  [streetKey(a.street), words(a.city).join(" "), a.state.trim().toUpperCase(), zip5(a.postalCode)].join("|");

const remember = (a: AddressFields, check: AddressCheck) => {
  const key = keyOf(a);
  cache.delete(key);
  cache.set(key, { check, at: Date.now() });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
};

const recall = (a: AddressFields): AddressCheck | null => {
  const hit = cache.get(keyOf(a));
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(keyOf(a));
    return null;
  }
  return hit.check;
};

/** For tests. */
export const clearAddressChecks = () => cache.clear();

/**
 * Checks an address with the carrier. Never throws: when the carrier can't be
 * asked, the answer is "unavailable" and checkout carries on as it always has.
 */
export const checkAddress = async (entered: AddressFields): Promise<AddressCheck> => {
  const known = recall(entered);
  if (known) return known;
  if (!isEasyPostConfigured()) return { status: "unavailable" };
  let verification: DeliveryVerification | null;
  try {
    verification = await verifyAddress({
      street1: entered.street,
      city: entered.city,
      state: entered.state,
      zip: entered.postalCode,
      country: "US",
    });
  } catch (err) {
    console.warn(`[address-check] carrier unavailable: ${(err as Error).message}`);
    return { status: "unavailable" };
  }
  const check = toAddressCheck(entered, verification);
  if (check.status === "unavailable") return check;
  remember(entered, check);
  // The carrier's own version is, by definition, one it can deliver to.
  if (check.status === "suggested") remember(check.suggestion, { status: "verified" });
  return check;
};

/** What the order records about the address it was placed with, from checkout's check. */
export const orderAddressCheck = (sent: AddressFields): OrderAddressCheck => {
  const check = recall(sent);
  if (!check || check.status === "unavailable") return { status: "unchecked" };
  if (check.status === "verified") return { status: "verified" };
  if (check.status === "suggested") return { status: "differs", suggestion: formatAddress(check.suggestion) };
  return { status: "not_found", reason: check.reason };
};
