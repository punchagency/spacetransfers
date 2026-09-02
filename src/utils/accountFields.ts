import { geocodeAddress } from "./geocoding.js";
import { getRegionFromCoords, getRegionFromState, normalizeRegion } from "./region.js";

/**
 * The pieces of an account that must come out the same however it was created.
 *
 * A partner who signs up and a partner an admin adds are the same kind of
 * record, but they were built by two unrelated blocks of code and diverged:
 * self-signup geocoded the address, stored coordinates, recorded a
 * `detectedRegion` and normalised the city through Census; the console did
 * none of that, so admin-created partners showed a blank region on their own
 * profile and on the partner detail page. Email format was validated on the
 * console path and not on the public one, which is backwards.
 *
 * Both paths now call these, so there is one definition of each rule.
 */

/**
 * Whether an address is one we could actually send mail to.
 *
 * Public signup performed no format check at all: "not-an-email",
 * "no-at-sign.com" and "spaces in@email.com" each created a working account.
 * Such an account can never receive verification, an invitation or a reset,
 * so it is unreachable the moment its password is forgotten.
 *
 * Deliberately a shape check, not RFC 5322 — the exhaustive grammar accepts
 * addresses no mail provider will, and rejects none of what actually matters
 * here.
 */
export const isValidEmail = (email: unknown): boolean =>
  typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

export interface RawAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface ResolvedAddress {
  /** Normalised through the geocoder where it resolved, else as supplied. */
  address: Required<RawAddress>;
  /** Present only when geocoding succeeded. */
  coordinates?: { lat: number; lng: number };
  /** Null when neither the geocoder nor the state code yields a region. */
  region: string | null;
  geocoded: boolean;
}

/**
 * Resolves an address to its canonical form and service region.
 *
 * Geocoding is best-effort: a failure falls back to the state code rather than
 * rejecting the address, because the state alone is enough to route on. A null
 * region is returned rather than a guess — assignment filters on region, so a
 * wrong one sends real work to the wrong side of the country, and "West" as a
 * default is exactly that mistake.
 */
export const resolveAddress = async (input: RawAddress): Promise<ResolvedAddress> => {
  let geocoded = null;
  try {
    geocoded = await geocodeAddress({
      street: input.street,
      city: input.city,
      state: input.state,
      zip: input.postalCode,
      country: input.country,
    });
  } catch {
    // Non-fatal; the state-code fallback below still gives us a region.
  }

  if (geocoded) {
    return {
      address: {
        street: geocoded.street || String(input.street || ""),
        city: geocoded.city || String(input.city || ""),
        state: geocoded.state || String(input.state || ""),
        postalCode: geocoded.zip || String(input.postalCode || ""),
        country: String(input.country || ""),
      },
      coordinates: { lat: geocoded.lat, lng: geocoded.lng },
      region:
        normalizeRegion(getRegionFromState(geocoded.state)) ??
        getRegionFromCoords(geocoded.lat, geocoded.lng),
      geocoded: true,
    };
  }

  return {
    address: {
      street: String(input.street || ""),
      city: String(input.city || ""),
      state: String(input.state || ""),
      postalCode: String(input.postalCode || ""),
      country: String(input.country || ""),
    },
    region: normalizeRegion(getRegionFromState(String(input.state || ""))),
    geocoded: false,
  };
};
