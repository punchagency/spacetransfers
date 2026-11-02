export interface PackagingBand {
  /** Upper bound of this band in square feet; null means "and above". */
  maxSqFt: number | null;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  /** Weight of the packaging itself — tube, mailer, tape. */
  tareLb: number;
}

export interface PackagingProfile {
  /** Weight of the printed film per square foot, excluding packaging. */
  weightPerSqFtLb: number;
  bands: PackagingBand[];
}

export interface Parcel {
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  /** True when the profile could not supply a band and the last resort was used. */
  estimated: boolean;
}

export const DEFAULT_PACKAGING_PROFILE: PackagingProfile = {
  // Placeholder: DTF film plus backing is light, but this has not been weighed.
  weightPerSqFtLb: 0.08,
  bands: [
    { maxSqFt: 6, lengthIn: 26, widthIn: 4, heightIn: 4, tareLb: 0.35 },
    { maxSqFt: 24, lengthIn: 26, widthIn: 6, heightIn: 6, tareLb: 0.6 },
    { maxSqFt: null, lengthIn: 26, widthIn: 9, heightIn: 9, tareLb: 1.0 },
  ],
};

const FALLBACK_BAND: PackagingBand = {
  maxSqFt: null,
  lengthIn: 26,
  widthIn: 9,
  heightIn: 9,
  tareLb: 1.0,
};

const positiveOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const nonNegativeOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const normalizePackagingProfile = (value: unknown): PackagingProfile => {
  const v = (value as any) || {};

  const bands: PackagingBand[] = (Array.isArray(v.bands) ? v.bands : [])
    .map((b: any) => ({
      // `null` is meaningful here — it is the open-ended top band — so it is
      // preserved rather than coerced into a number.
      maxSqFt:
        b?.maxSqFt === null || b?.maxSqFt === undefined || b?.maxSqFt === ""
          ? null
          : positiveOr(b.maxSqFt, NaN),
      lengthIn: positiveOr(b?.lengthIn, NaN),
      widthIn: positiveOr(b?.widthIn, NaN),
      heightIn: positiveOr(b?.heightIn, NaN),
      tareLb: nonNegativeOr(b?.tareLb, NaN),
    }))
    .filter(
      (b: PackagingBand) =>
        (b.maxSqFt === null || Number.isFinite(b.maxSqFt)) &&
        Number.isFinite(b.lengthIn) &&
        Number.isFinite(b.widthIn) &&
        Number.isFinite(b.heightIn) &&
        Number.isFinite(b.tareLb),
    )
    // Smallest first, with the open-ended band last, so selection can take the
    // first match regardless of the order the admin entered them in.
    .sort((a: PackagingBand, b: PackagingBand) => {
      if (a.maxSqFt === null) return 1;
      if (b.maxSqFt === null) return -1;
      return a.maxSqFt - b.maxSqFt;
    });

  return {
    weightPerSqFtLb: nonNegativeOr(
      v.weightPerSqFtLb,
      DEFAULT_PACKAGING_PROFILE.weightPerSqFtLb,
    ),
    bands: bands.length > 0 ? bands : DEFAULT_PACKAGING_PROFILE.bands,
  };
};

/** Rounded up: carriers bill in whole ounces and round against you. */
const roundWeight = (lb: number) => Math.ceil(lb * 100) / 100;

/**
 * The parcel for an order of a given total area.
 *
 * Area is the billed area, so the parcel and the price describe the same sheet.
 */
export const deriveParcel = (totalSqFt: number, profile: PackagingProfile): Parcel => {
  const area = Number.isFinite(totalSqFt) && totalSqFt > 0 ? totalSqFt : 0;

  const band =
    profile.bands.find((b) => b.maxSqFt === null || area <= b.maxSqFt) ??
    profile.bands[profile.bands.length - 1] ??
    FALLBACK_BAND;

  const contentLb = area * profile.weightPerSqFtLb;

  return {
    // Never zero: a carrier will reject a weightless parcel, and a sheet that
    // exists weighs something even if the profile says otherwise.
    weightLb: Math.max(0.1, roundWeight(band.tareLb + contentLb)),
    lengthIn: band.lengthIn,
    widthIn: band.widthIn,
    heightIn: band.heightIn,
    estimated: profile.bands.length === 0,
  };
};
