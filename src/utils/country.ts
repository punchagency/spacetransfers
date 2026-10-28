/** Common full country names, as customers type them, to ISO-3166-1 alpha-2 codes. */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", us: "US",
  canada: "CA",
  "united kingdom": "GB", uk: "GB",
  australia: "AU",
  germany: "DE",
  france: "FR",
  nigeria: "NG",
  ghana: "GH",
  kenya: "KE",
  "south africa": "ZA",
  india: "IN",
  china: "CN",
  japan: "JP",
  brazil: "BR",
  mexico: "MX",
};

/** A country as a 2-letter ISO code. Missing means the US, where the business ships. */
export const normaliseCountry = (raw: string | undefined | null): string => {
  if (!raw) return "US";
  const trimmed = raw.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] ?? trimmed.toUpperCase().slice(0, 2);
};
