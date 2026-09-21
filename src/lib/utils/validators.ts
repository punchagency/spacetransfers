/**
 * Mirrors `isValidPhone` in the server's `utils/accountFields.ts`. Kept in sync
 * by hand rather than shared, since this app cannot import server code — if the
 * server's rule changes, this one needs updating alongside it. The printer app
 * carries its own copy of the same rule for the same reason.
 *
 * Only presence was ever checked on this field — `if (!phone) errors.phone =
 * "required"` — so "1" or "abc" passed straight through and became the number
 * on a real order, which is what gets called when a shipment needs attention.
 * Deliberately loose on format: it accepts digits, spaces, hyphens, parens, a
 * leading "+", and requires 7–15 actual digits, so real international numbers
 * still work. It only rejects too few digits or letters — the shape a
 * placeholder takes.
 */
export const isValidPhone = (phone: string): boolean => {
  const trimmed = phone.trim();
  if (!trimmed) return false;
  if (!/^[+()\d\s.-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
};
