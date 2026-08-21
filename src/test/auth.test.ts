import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  clearAuth,
  getToken,
  getUser,
  isAuthenticated,
  isTokenExpired,
  setAuth,
  subscribeToAuth,
} from "../utils/auth";

/**
 * Builds a JWT-shaped string with the given payload. Only the payload segment
 * is ever read client-side (the server verifies the signature), so the header
 * and signature are placeholders.
 */
const makeToken = (payload: Record<string, unknown>) => {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
};

const nowSec = () => Math.floor(Date.now() / 1000);

const ADMIN = { id: "1", name: "Ada", email: "ada@example.com", role: "ADMIN" };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isTokenExpired", () => {
  it("treats a token whose exp has passed as expired", () => {
    expect(isTokenExpired(makeToken({ exp: nowSec() - 60 }))).toBe(true);
  });

  it("treats a token with a future exp as live", () => {
    expect(isTokenExpired(makeToken({ exp: nowSec() + 3600 }))).toBe(false);
  });

  it("expires a token inside the clock-skew window, so a fast clock can't slip one through", () => {
    // SKEW_SECONDS is 30; an exp 10s away is already treated as expired.
    expect(isTokenExpired(makeToken({ exp: nowSec() + 10 }))).toBe(true);
  });

  it("cannot prove a token with no exp is expired, and says so rather than locking the user out", () => {
    expect(isTokenExpired(makeToken({ sub: "1" }))).toBe(false);
  });

  it("does not throw on a string that isn't a JWT", () => {
    expect(isTokenExpired("not-a-jwt")).toBe(false);
    expect(isTokenExpired("")).toBe(false);
  });
});

describe("isAuthenticated", () => {
  it("is false with no session at all", () => {
    expect(isAuthenticated()).toBe(false);
  });

  it("is true for a live token belonging to an admin", () => {
    setAuth(makeToken({ exp: nowSec() + 3600 }), ADMIN);
    expect(isAuthenticated()).toBe(true);
  });

  it("is false once the token has expired, even though it is still stored", () => {
    setAuth(makeToken({ exp: nowSec() - 1 }), ADMIN);
    expect(getToken()).not.toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it("rejects a live token belonging to a printer — the admin app is not theirs to open", () => {
    setAuth(makeToken({ exp: nowSec() + 3600 }), { ...ADMIN, role: "PRINTER" });
    expect(isAuthenticated()).toBe(false);
  });

  it("rejects a customer token for the same reason", () => {
    setAuth(makeToken({ exp: nowSec() + 3600 }), { ...ADMIN, role: "CUSTOMER" });
    expect(isAuthenticated()).toBe(false);
  });

  it("allows a session saved before the role was persisted — the server still gates it", () => {
    setAuth(makeToken({ exp: nowSec() + 3600 }), { id: "1", name: "Ada" });
    expect(isAuthenticated()).toBe(true);
  });

  it("is false after clearAuth, which is what a 401 triggers", () => {
    setAuth(makeToken({ exp: nowSec() + 3600 }), ADMIN);
    clearAuth();
    expect(isAuthenticated()).toBe(false);
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

describe("setAuth / getUser", () => {
  it("round-trips the user object", () => {
    setAuth(makeToken({ exp: nowSec() + 3600 }), ADMIN);
    expect(getUser()).toEqual(ADMIN);
  });

  it("returns null rather than throwing when the stored user is corrupt", () => {
    localStorage.setItem("admin_user", "{not json");
    expect(getUser()).toBeNull();
  });
});

describe("subscribeToAuth", () => {
  it("notifies the current tab on sign-in and sign-out, so the route guard reacts immediately", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeToAuth(seen);

    setAuth(makeToken({ exp: nowSec() + 3600 }), ADMIN);
    expect(seen).toHaveBeenCalledTimes(1);

    clearAuth();
    expect(seen).toHaveBeenCalledTimes(2);

    unsubscribe();
    setAuth(makeToken({ exp: nowSec() + 3600 }), ADMIN);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("notifies on a storage event from another tab", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeToAuth(seen);

    window.dispatchEvent(new StorageEvent("storage", { key: "admin_token" }));
    expect(seen).toHaveBeenCalledTimes(1);

    // An unrelated key must not churn the guard.
    window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key" }));
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
