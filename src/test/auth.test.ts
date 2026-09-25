import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_CHANGED_EVENT,
  clearAuth,
  getToken,
  getUser,
  isAuthenticated,
  isTokenExpired,
  setAuth,
  subscribeToAuth,
  updateStoredUser,
} from "../utils/auth";

/** A JWT with the given `exp` (seconds). Only the payload is read, so the signature is a placeholder. */
const tokenExpiring = (expSeconds: number) =>
  `header.${btoa(JSON.stringify({ exp: expSeconds }))}.signature`;

const printer = { id: "p1", name: "Ada", email: "ada@example.com", role: "PRINTER" } as const;

describe("session storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("keeps the token and user, and tells the app the session changed", () => {
    const seen = vi.fn();
    const stop = subscribeToAuth(seen);
    setAuth("abc", { ...printer });
    expect(getToken()).toBe("abc");
    expect(getUser()?.email).toBe("ada@example.com");
    expect(seen).toHaveBeenCalled();
    stop();
  });

  it("signing out clears both and notifies again", () => {
    setAuth("abc", { ...printer });
    const seen = vi.fn();
    const stop = subscribeToAuth(seen);
    clearAuth();
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
    expect(seen).toHaveBeenCalled();
    stop();
  });

  /*
   * The profile store used to read and JSON.parse storage directly, so one
   * corrupted value threw during render and took the whole app down on load.
   */
  it("a corrupted stored user reads as no user rather than throwing", () => {
    localStorage.setItem("printer_user", "{not json");
    expect(() => getUser()).not.toThrow();
    expect(getUser()).toBeNull();
  });

  it("updating the stored user merges into what is there, and does nothing when signed out", () => {
    setAuth("abc", { ...printer });
    updateStoredUser({ name: "Ada L" });
    expect(getUser()).toMatchObject({ name: "Ada L", email: "ada@example.com" });

    localStorage.clear();
    expect(() => updateStoredUser({ name: "nobody" })).not.toThrow();
    expect(getUser()).toBeNull();
  });

  it("notifies on a sign-out in another tab", () => {
    const seen = vi.fn();
    const stop = subscribeToAuth(seen);
    window.dispatchEvent(new StorageEvent("storage", { key: "printer_token" }));
    expect(seen).toHaveBeenCalled();
    stop();
  });

  it("dispatches its own event name so other tabs and this one both hear it", () => {
    const seen = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, seen);
    setAuth("abc", { ...printer });
    expect(seen).toHaveBeenCalled();
    window.removeEventListener(AUTH_CHANGED_EVENT, seen);
  });
});

describe("token expiry", () => {
  beforeEach(() => localStorage.clear());

  it("an expired token is expired; a future one is not", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTokenExpired(tokenExpiring(now - 60))).toBe(true);
    expect(isTokenExpired(tokenExpiring(now + 3600))).toBe(false);
  });

  it("counts a token inside the 30-second skew as expired", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTokenExpired(tokenExpiring(now + 10))).toBe(true);
  });

  /*
   * "Can't prove it's expired" must mean "let it through": the server is the
   * real authority, and failing closed here would lock out every session under
   * a scheme this parser doesn't recognise.
   */
  it("a token it cannot read is not treated as expired", () => {
    expect(isTokenExpired("not-a-jwt")).toBe(false);
    expect(isTokenExpired("")).toBe(false);
    expect(isTokenExpired(`header.${btoa(JSON.stringify({ sub: "x" }))}.sig`)).toBe(false);
  });
});

describe("isAuthenticated", () => {
  beforeEach(() => localStorage.clear());
  const future = () => tokenExpiring(Math.floor(Date.now() / 1000) + 3600);

  it("needs a token", () => {
    expect(isAuthenticated()).toBe(false);
  });

  it("accepts a live printer session", () => {
    setAuth(future(), { ...printer });
    expect(isAuthenticated()).toBe(true);
  });

  it("refuses an expired token and another app's role", () => {
    setAuth(tokenExpiring(Math.floor(Date.now() / 1000) - 60), { ...printer });
    expect(isAuthenticated()).toBe(false);

    setAuth(future(), { ...printer, role: "CUSTOMER" });
    expect(isAuthenticated()).toBe(false);
  });

  /* An older session saved before the role was stored still belongs to someone. */
  it("allows a session with no role recorded, leaving the server to judge it", () => {
    setAuth(future(), { id: "p1", name: "Ada", email: "ada@example.com" } as never);
    expect(isAuthenticated()).toBe(true);
  });
});
