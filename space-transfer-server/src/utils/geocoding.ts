/**
 * US Census Bureau Geocoding Service — free, no API key required.
 * https://geocoding.geo.census.gov/geocoder
 *
 * Falls back gracefully when the Census API is unavailable; callers should
 * always check for a null return and degrade to state-based region detection.
 *
 * Designed for US addresses only. Architecture is intentionally country-agnostic
 * so adding additional geocoding providers (Google Maps, HERE, etc.) for other
 * countries requires no structural changes — just extend `geocodeAddress()`.
 */

export interface AddressInput {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface GeocodeResult {
  normalizedAddress: string;
  street: string;
  city: string;
  state: string;      // 2-letter uppercase (e.g. "CA")
  zip: string;
  lat: number;
  lng: number;
  country: string;    // Always "US" for Census results
}

// ---------------------------------------------------------------------------
// In-memory TTL cache — avoids repeat Census API calls for same addresses.
// Eviction is lazy (on next read); size is bounded by server restarts.
// ---------------------------------------------------------------------------
interface CacheEntry { result: GeocodeResult | null; ts: number }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function _cacheKey(input: AddressInput): string {
  return JSON.stringify({
    s: (input.street  || "").toLowerCase().trim().replace(/\s+/g, " "),
    c: (input.city    || "").toLowerCase().trim(),
    t: (input.state   || "").toLowerCase().trim(),
    z: (input.zip     || "").trim(),
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Geocode a US address. Returns a normalised result with coordinates, or null
 * when the address cannot be matched (Census API down, address not found, etc.)
 *
 * Analytics events are emitted via console so they can be captured by any
 * log-shipping integration (Datadog, CloudWatch, etc.) without additional deps.
 */
export async function geocodeAddress(input: AddressInput): Promise<GeocodeResult | null> {
  const key = _cacheKey(input);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    const hit = cached.result ? "HIT" : "HIT_NULL";
    console.log(`[geocoding] cache_${hit} key=${key.slice(0, 60)}`);
    return cached.result;
  }

  const result = await _fetchCensus(input);
  _cache.set(key, { result, ts: Date.now() });

  if (result) {
    console.log(
      `[geocoding] SUCCESS normalised="${result.normalizedAddress}" ` +
      `state=${result.state} zip=${result.zip} lat=${result.lat} lng=${result.lng}`
    );
  } else {
    console.warn(
      `[geocoding] FAILED street="${input.street}" city="${input.city}" ` +
      `state="${input.state}" zip="${input.zip}"`
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// US Census Bureau implementation
// ---------------------------------------------------------------------------

async function _fetchCensus(input: AddressInput): Promise<GeocodeResult | null> {
  try {
    const params = new URLSearchParams({
      benchmark: "Public_AR_Current",
      format: "json",
    });
    if (input.street) params.set("street", input.street);
    if (input.city)   params.set("city",   input.city);
    if (input.state)  params.set("state",  input.state);
    if (input.zip)    params.set("zip",    input.zip);

    const url = `https://geocoding.geo.census.gov/geocoder/locations/address?${params}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6_000),
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      console.warn(`[geocoding] Census API HTTP ${res.status}`);
      return null;
    }

    const data = await res.json() as any;
    const matches: any[] = data?.result?.addressMatches;
    if (!Array.isArray(matches) || matches.length === 0) return null;

    const m = matches[0];
    const c = m.addressComponents || {};
    const lat = m.coordinates?.y;
    const lng = m.coordinates?.x;

    // Reconstruct a clean street string from components
    const street = [
      c.fromAddress,
      c.preDirection,
      c.streetName,
      c.sufType,
      c.sufDirection,
    ].filter(Boolean).join(" ").trim();

    return {
      normalizedAddress: m.matchedAddress || "",
      street: street || (input.street || ""),
      city:  (c.city  || "").toUpperCase(),
      state: (c.state || "").toUpperCase(),
      zip:    c.zip   || "",
      lat: typeof lat === "number" ? lat : 0,
      lng: typeof lng === "number" ? lng : 0,
      country: "US",
    };
  } catch (err) {
    console.warn("[geocoding] Census API error:", (err as Error).message ?? err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the country string refers to the United States. */
export function isUSCountry(country?: string | null): boolean {
  if (!country) return false;
  const c = country.trim().toLowerCase().replace(/\./g, "");
  return ["us", "usa", "united states", "united states of america"].includes(c);
}
