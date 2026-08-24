/**
 * The order number to show the customer.
 *
 * `displayId` (DTF-0244) is the canonical number — it appears on their invoice,
 * in confirmation emails and in every internal tool. These surfaces used to
 * derive their own from the ObjectId, so a customer quoting the number they
 * saw could not be found by support.
 *
 * The slice is a fallback only, for orders created before displayId existed.
 */
export function formatOrderNumber(
  displayId?: string | null,
  rawId?: string | null,
): string {
  if (displayId) return String(displayId);
  const raw = String(rawId || "");
  return raw ? `#${raw.slice(-8).toUpperCase()}` : "—";
}
