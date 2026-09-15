import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartLineKey,
  cartSignInMessage,
  mergeCarts,
  readCartOwner,
  repriceCart,
  repriceCartLine,
  writeCartOwner,
} from "../lib/utils/cartSync";
import { billableSheetDimensions, getMinSheetLengthIn, getPricePerSqFt, getSheetWidthIn } from "../lib/utils/pricingRates";

const sheet = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  type: "gangsheet",
  designSignature: "abc",
  widthIn: getSheetWidthIn(),
  heightIn: getMinSheetLengthIn() + 5,
  price: 1,
  quantity: 1,
  ...overrides,
});

describe("mergeCarts", () => {
  it("keeps the account's lines and adds the browser's new ones after them", () => {
    const account = [sheet({ id: 1, designSignature: "a" })];
    const browser = [sheet({ id: 2, designSignature: "b" })];
    expect(mergeCarts(account, browser).map(cartLineKey)).toEqual(["sig:a", "sig:b"]);
  });

  it("does not duplicate a sheet that is in both, and keeps the account's copy", () => {
    const account = [sheet({ id: 1, designSignature: "a", items: [{ croppedUrl: "https://cdn/cut.png" }] })];
    // The browser's copy lost its embedded artwork to fit in storage.
    const browser = [sheet({ id: 1, designSignature: "a", items: [{ croppedUrl: null }] })];
    const merged = mergeCarts(account, browser);
    expect(merged).toHaveLength(1);
    expect(merged[0].items[0].croppedUrl).toBe("https://cdn/cut.png");
  });

  it("tells reorder lines apart by id", () => {
    const reorder = (id: number) => ({ id, type: "gangsheet", widthIn: getSheetWidthIn(), heightIn: 12 });
    expect(mergeCarts([reorder(1)], [reorder(1), reorder(2)])).toHaveLength(2);
  });
});

describe("repriceCartLine", () => {
  it("prices a sheet the way the server charges: roll width × at least the minimum length × rate", () => {
    const line = sheet({ heightIn: 30, price: 999 });
    const billed = billableSheetDimensions(30);
    expect(repriceCartLine(line).price).toBe(+(billed.areaSf * getPricePerSqFt()).toFixed(2));
  });

  it("raises a line to the minimum length when the minimum went up", () => {
    const line = sheet({ heightIn: getMinSheetLengthIn() - 2 });
    expect(repriceCartLine(line).heightIn).toBe(getMinSheetLengthIn());
  });

  it("never changes the width of a sheet laid out on a different roll", () => {
    // Checkout refuses it with a clear message; rewriting the width would slip
    // it past that check onto a roll its placements do not fit.
    const line = sheet({ widthIn: getSheetWidthIn() + 2, price: 5 });
    expect(repriceCartLine(line)).toBe(line);
  });

  it("returns the same object when nothing changes, and leaves other line types alone", () => {
    const current = repriceCartLine(sheet({ heightIn: 30 }));
    expect(repriceCartLine(current)).toBe(current);
    const other = { id: 9, type: "sticker", price: 3 };
    expect(repriceCartLine(other)).toBe(other);
    const cart = [current, other];
    expect(repriceCart(cart)).toBe(cart);
  });
});

describe("cart owner", () => {
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

  it("records and clears which account the browser's cart belongs to", () => {
    expect(readCartOwner()).toBeNull();
    writeCartOwner("user-1");
    expect(readCartOwner()).toBe("user-1");
    writeCartOwner(null);
    expect(readCartOwner()).toBeNull();
  });
});

describe("cartSignInMessage", () => {
  it("says what came back and what was added while signed out", () => {
    expect(cartSignInMessage(0, 0)).toBeNull();
    expect(cartSignInMessage(1, 0)).toBe("1 item from your saved cart was added back.");
    expect(cartSignInMessage(0, 2)).toBe("2 items you added while signed out are now saved to your account.");
    expect(cartSignInMessage(3, 1)).toBe("Your cart has 3 items from your saved cart and 1 item you added while signed out.");
  });
});
