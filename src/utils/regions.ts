/**
 * The service regions the backend actually recognises.
 *
 * Mirrors `getRegionFromState` / `normalizeRegion` in
 * `space-transfer-server/src/utils/region.ts`, which maps every US state to
 * exactly one of these four. Anything outside this list normalizes to `null`,
 * and a null region blocks order assignment entirely — so offering a region
 * here that the server does not know is not a cosmetic mismatch, it silently
 * makes a partner unassignable.
 *
 * Previously this list was duplicated in three places and offered seven values:
 * `Central` and `Pacific Northwest` both normalized to null, and `Southwest`
 * silently collapsed into `South`.
 */
export const REGIONS = ["West", "Midwest", "South", "Northeast"] as const;

export type Region = (typeof REGIONS)[number];
