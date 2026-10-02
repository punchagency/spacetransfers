export const REGIONS = ["West", "Midwest", "South", "Northeast"] as const;

export type Region = (typeof REGIONS)[number];
