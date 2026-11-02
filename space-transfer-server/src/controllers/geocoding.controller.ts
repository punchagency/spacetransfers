import { Request, Response, NextFunction } from "express";
import { geocodeAddress, isUSCountry } from "../utils/geocoding.js";
import { getRegionFromState, getRegionFromCoords, normalizeRegion } from "../utils/region.js";

/**
 * POST /api/geocode/validate
 *
 * Validates and geocodes a US address. Returns normalized address fields,
 * coordinates, and the automatically assigned service region.
 *
 * Response shapes:
 *  - 200 valid: true  → geocoding succeeded, normalised address returned
 *  - 200 valid: false + fallback: true → geocoding failed but region inferred from state code
 *  - 422               → non-US address or no usable input provided
 */
export const validateAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { street, city, state, zip, postalCode, country } = req.body as Record<string, string | undefined>;
    const resolvedZip = zip || postalCode;

    // ── 1. US-only restriction ──────────────────────────────────────────────
    if (country && !isUSCountry(country)) {
      console.log(`[geocoding] rejected non-US country="${country}"`);
      return res.status(422).json({
        valid: false,
        error: "Only US addresses are supported at this time.",
        code: "NON_US_ADDRESS",
      });
    }

    // Require at least one meaningful input
    if (!street && !city && !state && !resolvedZip) {
      return res.status(422).json({
        valid: false,
        error: "Please provide at least a state or postal code.",
        code: "INSUFFICIENT_INPUT",
      });
    }

    // ── 2. Geocode ──────────────────────────────────────────────────────────
    const geocoded = await geocodeAddress({ street, city, state, zip: resolvedZip });

    // ── 3. Resolve region ───────────────────────────────────────────────────
    if (geocoded) {
      const region =
        normalizeRegion(getRegionFromState(geocoded.state)) ??
        getRegionFromCoords(geocoded.lat, geocoded.lng);

      console.log(
        `[region-assign] src=api state=${geocoded.state} zip=${geocoded.zip} ` +
        `region=${region} lat=${geocoded.lat} lng=${geocoded.lng} geocoded=true`
      );

      return res.json({
        valid: true,
        normalizedAddress: geocoded.normalizedAddress,
        street: geocoded.street,
        city:   geocoded.city,
        state:  geocoded.state,
        zip:    geocoded.zip,
        lat:    geocoded.lat,
        lng:    geocoded.lng,
        region,
      });
    }

    // ── 4. Fallback — derive region from raw state code if available ────────
    if (state) {
      const stateUpper = state.trim().toUpperCase();
      const region = getRegionFromState(stateUpper);
      console.log(
        `[region-assign] src=api_fallback state=${stateUpper} region=${region} geocoded=false`
      );
      return res.json({
        valid: false,
        fallback: true,
        region,
        state: stateUpper,
        error: "Address could not be verified. Please confirm it is correct.",
        code: "GEOCODE_FAILED",
      });
    }

    // ── 5. Cannot resolve at all ────────────────────────────────────────────
    console.warn(
      `[geocoding] unresolvable address street="${street}" city="${city}" zip="${resolvedZip}"`
    );
    return res.status(422).json({
      valid: false,
      error: "Address could not be validated. Please provide a valid US address with at least a state.",
      code: "GEOCODE_FAILED",
    });
  } catch (error) {
    next(error);
  }
};
