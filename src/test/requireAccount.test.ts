import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUIRE_ACCOUNT_EVENT, requireAccount } from "../lib/requireAccount";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  clear: () => store.clear(),
});

afterEach(() => store.clear());

describe("tools that need an account", () => {
  it("let a signed-in customer through", () => {
    localStorage.setItem("token", "t");
    expect(() => requireAccount("boost resolution")).not.toThrow();
  });

  it("stop a guest, say why, and ask for sign-in", () => {
    const heard = vi.fn();
    window.addEventListener(REQUIRE_ACCOUNT_EVENT, heard);
    expect(() => requireAccount("use AI edits")).toThrow("Sign in to use AI edits. Your sheet stays as it is.");
    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ what: "use AI edits" });
    window.removeEventListener(REQUIRE_ACCOUNT_EVENT, heard);
  });
});
