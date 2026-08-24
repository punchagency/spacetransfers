/**
 * The order number to show the user.
 *
 * `displayId` (DTF-0244) is canonical — it is what appears on invoices, in
 * notifications, in ShipStation and in every search box. Surfaces used to
 * derive their own from the ObjectId instead, so the same order appeared as
 * DTF-0244, 7F3F9CA3, 3F9CA3 and ORD-9CA3 depending on where you looked.
 *
 * The slice is a fallback only, for orders created before displayId existed.
 */
export const formatOrderNumber = (
  displayId?: string | null,
  rawId?: string | null,
): string => {
  if (displayId) return String(displayId);
  const raw = String(rawId || "");
  return raw ? `#${raw.slice(-8).toUpperCase()}` : "—";
};
