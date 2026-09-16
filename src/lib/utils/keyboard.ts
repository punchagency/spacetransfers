/**
 * Whether a key press belongs to whatever the customer is typing in.
 *
 * Single-key shortcuts (N to nest, S for settings, C for the cart) must never
 * fire while a field has focus. Checking the tag name alone was too broad: the
 * artboard's file picker is an `<input type="file">`, and it holds focus right
 * after a drop — so every shortcut was swallowed until something else was
 * clicked. Only fields that take text (and content-editable areas) capture keys.
 */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
};
