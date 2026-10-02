export const formatOrderNumber = (
  displayId?: string | null,
  rawId?: string | null,
): string => {
  if (displayId) return String(displayId);
  const raw = String(rawId || "");
  return raw ? `#${raw.slice(-8).toUpperCase()}` : "—";
};
