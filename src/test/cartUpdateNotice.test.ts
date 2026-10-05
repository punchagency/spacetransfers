import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartUpdateNoticeHidden,
  cartUpdateNoticeText,
  setCartUpdateNoticeHidden,
  showCartUpdateNotice,
} from "../components/common/CartUpdateNotice";

describe("cart update notice", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the sheet and says the cart follows it", () => {
    const { title, body } = cartUpdateNoticeText("Team shirts");
    expect(title).toBe("“Team shirts” is in your cart");
    expect(body).toMatch(/update it in your cart/);
  });

  it("has a title without a name", () => {
    expect(cartUpdateNoticeText(null).title).toBe("This sheet is in your cart");
  });

  it("shows by default, and stops once the customer opts out", () => {
    expect(cartUpdateNoticeHidden()).toBe(false);
    expect(showCartUpdateNotice("Team shirts")).toBe(true);
    setCartUpdateNoticeHidden(true);
    expect(cartUpdateNoticeHidden()).toBe(true);
    expect(showCartUpdateNotice("Team shirts")).toBe(false);
  });

  it("shows again when the opt-out is undone", () => {
    setCartUpdateNoticeHidden(true);
    setCartUpdateNoticeHidden(false);
    expect(showCartUpdateNotice("Team shirts")).toBe(true);
  });
});
