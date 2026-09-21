import { describe, expect, it } from "vitest";
import { isTypingTarget } from "../lib/utils/keyboard";

/**
 * Single-key shortcuts must not fire while someone is typing — and must still
 * fire otherwise. The artboard's file picker is an `<input type="file">` that
 * holds focus right after a drop, which swallowed every shortcut.
 */
const input = (type: string) => {
  const el = document.createElement("input");
  el.type = type;
  return el;
};

describe("isTypingTarget", () => {
  it("is true for fields that take text", () => {
    for (const type of ["text", "search", "email", "number", "password", "tel", "url"]) {
      expect(isTypingTarget(input(type))).toBe(true);
    }
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("is true for a content-editable area", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(el, "isContentEditable", { value: true });
    expect(isTypingTarget(el)).toBe(true);
  });

  it("is false for the file picker, so a shortcut works right after a drop", () => {
    expect(isTypingTarget(input("file"))).toBe(false);
  });

  it("is false for buttons, checkboxes, the canvas and nothing at all", () => {
    expect(isTypingTarget(input("checkbox"))).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.createElement("canvas"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
