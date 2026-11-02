import { apiFetch } from "./api";

export interface AddressFields {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

export type NotFoundReason = "missing_unit" | "invalid_unit" | "house_number" | "not_found";

/** The carrier's verdict on a shipping address (see the API's addressCheck.service). */
export type AddressCheck =
  | { status: "verified" }
  /** `changed`: the parts that really differ, not just in spelling. */
  | { status: "suggested"; suggestion: AddressFields; changed: (keyof AddressFields)[] }
  | { status: "not_found"; reason: NotFoundReason }
  | { status: "unavailable" };

/** One address, however it was typed: what checkout remembers a decision by. */
export const addressKey = (a: AddressFields) =>
  [a.street, a.city, a.state, a.postalCode].map((v) => String(v || "").trim().toUpperCase().replace(/\s+/g, " ")).join("|");

/**
 * Asks the carrier whether it can deliver to the address. Never throws: if the
 * check can't be made, checkout goes on without it, as it did before.
 */
export const checkShippingAddress = async (a: AddressFields): Promise<AddressCheck> => {
  try {
    const r = await apiFetch("/customer/addresses/check", {
      method: "POST",
      body: JSON.stringify({ street: a.street, city: a.city, state: a.state, postalCode: a.postalCode }),
      timeoutMs: 12_000,
    });
    if (r?.status === "verified" || r?.status === "unavailable") return { status: r.status };
    if (r?.status === "suggested" && r.suggestion?.street && r.suggestion?.postalCode) {
      return { status: "suggested", suggestion: r.suggestion, changed: Array.isArray(r.changed) ? r.changed : [] };
    }
    if (r?.status === "not_found") return { status: "not_found", reason: r.reason || "not_found" };
  } catch {
    // Unreachable or rate limited: no verdict, so no prompt.
  }
  return { status: "unavailable" };
};

export const NOT_FOUND_HINT: Record<NotFoundReason, string> = {
  missing_unit: "This building has more than one unit. Add your apartment or suite number.",
  invalid_unit: "The apartment or suite number doesn't match this building.",
  house_number: "The house or building number doesn't match this street.",
  not_found: "The carrier couldn't find this address. Check the street, city and ZIP code.",
};
