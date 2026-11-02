/**
 * Mirrors `isValidPhone` in the server's `utils/accountFields.ts`. Kept in sync
 * by hand rather than shared, since this app cannot import server code — if the
 * server's rule changes, this one needs updating alongside it.
 *
 * Lives here rather than inside a component: signup and the profile editor both
 * need it, and a second hand-written copy is how the two drift apart.
 */
export const isValidPhone = (phone: string): boolean => {
  const trimmed = phone.trim();
  if (!trimmed) return false;
  if (!/^[+()\d\s.-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
};
