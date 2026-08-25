import {
  getShipStationRates,
  isShipStationConfigured,
  type CarrierRate,
} from "./shipstation.service.js";
import { deriveParcel, type PackagingProfile } from "./packaging.service.js";

/**
 * What to charge for shipping.
 *
 * Replaces two flat numbers that could not tell a $6 parcel from a $40 one.
 * The carrier is asked for real rates against a real parcel; the configured
 * flat rates remain, demoted to the fallback used when the carrier cannot be
 * reached.
 */

/**
 * Handling, as a percentage of what the carrier charges.
 *
 * A flat amount was tried first and dropped: one number is one number, and a
 * percentage scales with the parcel, which is what handling roughly does.
 * Worth knowing that packaging cost does *not* scale — a tube costs the same on
 * a cheap parcel as an expensive one — so a percentage under-recovers on small
 * orders. Set it with that in mind.
 */
export type ShippingMarkupPct = number;

export interface ShippingQuote {
  cost: number;
  /** Where the rate was quoted from, so a mis-quote can be traced to its origin. */
  originPostalCode: string | null;
  originPartnerRegion: string | null;
  /** Carrier's own price, before markup. Null when the fallback was used. */
  carrierCost: number | null;
  serviceName: string | null;
  serviceCode: string | null;
  /** How this number was arrived at — surfaced so a fallback is never silent. */
  source: "carrier" | "fallback";
  fallbackReason?: string;
}

export interface ShippingDestination {
  state: string;
  postalCode: string;
  country: string;
  city?: string;
  residential?: boolean;
}

const roundToTwo = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * "standard" is the cheapest service the carrier offers; "express" the
 * cheapest that is meaningfully faster.
 *
 * Chosen by cost rather than by a hard-coded service code because which
 * services exist depends on the ShipStation account and the destination.
 */
const selectService = (rates: CarrierRate[], method: "standard" | "express"): CarrierRate | null => {
  if (rates.length === 0) return null;
  // getShipStationRates sorts ascending by cost.
  if (method === "standard") return rates[0];

  const expedited = rates.filter((r) => /express|priority|overnight|2.?day|next.?day/i.test(r.serviceName));
  // If nothing advertises itself as expedited, the dearest service is the best
  // available proxy — never the cheapest, which is what "standard" already is.
  return expedited[0] ?? rates[rates.length - 1] ?? null;
};

export const applyMarkup = (carrierCost: number, markupPct: ShippingMarkupPct): number =>
  roundToTwo(carrierCost * (1 + markupPct / 100));

/**
 * Falls back to the configured flat rate rather than failing the checkout.
 *
 * A carrier outage should not stop revenue, but it must not be invisible
 * either: every fallback is logged with its reason, and the quote says which
 * source it came from so the order can record it.
 */
export const quoteShipping = async (params: {
  totalSqFt: number;
  method: "standard" | "express";
  destination: ShippingDestination | null;
  packaging: PackagingProfile;
  markupPct: ShippingMarkupPct;
  /** The likely ship-from, from `predictShippingOrigin`. */
  origin?: { postalCode: string; region: string } | null;
  fallbackRates: { standard: number; express: number };
}): Promise<ShippingQuote> => {
  const { method, destination, fallbackRates } = params;

  const fallback = (reason: string): ShippingQuote => {
    console.warn(`[SHIPPING] falling back to the flat ${method} rate — ${reason}`);
    return {
      cost: roundToTwo(fallbackRates[method]),
      carrierCost: null,
      serviceName: null,
      serviceCode: null,
      originPostalCode: params.origin?.postalCode ?? null,
      originPartnerRegion: params.origin?.region ?? null,
      source: "fallback",
      fallbackReason: reason,
    };
  };

  if (!isShipStationConfigured()) return fallback("ShipStation is not configured");
  if (!destination?.postalCode || !destination?.country) {
    return fallback("no destination address yet");
  }

  const parcel = deriveParcel(params.totalSqFt, params.packaging);

  try {
    const rates = await getShipStationRates({
      toState: destination.state,
      toPostalCode: destination.postalCode,
      toCountry: destination.country,
      toCity: destination.city,
      residential: destination.residential,
      parcel,
      fromPostalCode: params.origin?.postalCode,
    });

    const chosen = selectService(rates, method);
    if (!chosen) return fallback("the carrier returned no rates for this parcel");

    return {
      cost: applyMarkup(chosen.costUsd, params.markupPct),
      carrierCost: roundToTwo(chosen.costUsd),
      serviceName: chosen.serviceName,
      serviceCode: chosen.serviceCode,
      originPostalCode: params.origin?.postalCode ?? null,
      originPartnerRegion: params.origin?.region ?? null,
      source: "carrier",
    };
  } catch (error: any) {
    return fallback(error?.message || "the carrier rate request failed");
  }
};
