import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiFetch } from "../utils/api";
import { setAuth, getToken, isAuthenticated } from "../utils/auth";

/**
 * A 401 means two completely different things depending on where it came from:
 *
 *  - from `/auth/login` it is a rejected credential — there is no session yet,
 *  - from anywhere else it is a dead session.
 *
 * Conflating them told anyone who mistyped a password that their token was
 * "invalid or expired", which explains nothing they can act on. These tests
 * pin both behaviours.
 */

const makeToken = (payload: Record<string, unknown>) => {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
};
const liveToken = () => makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiFetch — 401 on sign-in", () => {
  it("surfaces the server's reason instead of a token message", async () => {
    vi.stubGlobal("fetch", respond(401, { message: "Invalid credentials" }));

    await expect(
      apiFetch("/auth/login", { method: "POST", body: "{}" }),
    ).rejects.toThrow("Invalid credentials");
  });

  it("does not clear an existing session when a sign-in is rejected", async () => {
    setAuth(liveToken(), { id: "1", role: "ADMIN" });
    vi.stubGlobal("fetch", respond(401, { message: "Invalid credentials" }));

    await expect(apiFetch("/auth/login", { method: "POST", body: "{}" })).rejects.toThrow();

    expect(getToken()).not.toBeNull();
    expect(isAuthenticated()).toBe(true);
  });

  it("still reports something useful when the server sends no message", async () => {
    vi.stubGlobal("fetch", respond(401, {}));

    await expect(
      apiFetch("/auth/login", { method: "POST", body: "{}" }),
    ).rejects.toThrow("Something went wrong");
  });
});

describe("apiFetch — 401 on any other endpoint", () => {
  it("clears the session so the route guard redirects", async () => {
    setAuth(liveToken(), { id: "1", role: "ADMIN" });
    expect(isAuthenticated()).toBe(true);

    vi.stubGlobal("fetch", respond(401, { message: "Invalid or expired token" }));

    await expect(apiFetch("/admin/dashboard/stats")).rejects.toThrow();

    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it("falls back to an expiry message the user can act on", async () => {
    setAuth(liveToken(), { id: "1", role: "ADMIN" });
    vi.stubGlobal("fetch", respond(401, {}));

    await expect(apiFetch("/admin/dashboard/stats")).rejects.toThrow(
      "Your session has expired. Please sign in again.",
    );
  });
});

describe("apiFetch — 403 is not a session failure", () => {
  it("keeps the session when a submitted password is wrong", async () => {
    // PATCH /admin/profile/password returns 403 for a wrong *current* password
    // on an otherwise valid session. Logging the admin out there would be wrong.
    setAuth(liveToken(), { id: "1", role: "ADMIN" });
    vi.stubGlobal("fetch", respond(403, { message: "Current password is incorrect" }));

    await expect(
      apiFetch("/admin/profile/password", { method: "PATCH", body: "{}" }),
    ).rejects.toThrow("Current password is incorrect");

    expect(isAuthenticated()).toBe(true);
  });
});

describe("apiFetch — unreachable server", () => {
  it("says the backend is unreachable rather than surfacing a raw fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(apiFetch("/admin/dashboard/stats")).rejects.toThrow(
      /API server is not reachable/,
    );
  });
});
