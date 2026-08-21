/**
 * Single source of truth for admin auth state.
 *
 * Everything that reads or writes the session goes through here so that:
 *  - expiry is actually checked (a token's mere presence is not "logged in"),
 *  - the role is enforced (a printer/customer token can't open the admin app),
 *  - every part of the UI is notified the instant the session changes, in this
 *    tab (custom event) and in other tabs (native `storage` event).
 *
 * Mirrors the printer app's `utils/auth.ts`; the only differences are the
 * storage keys and the required role.
 */

const TOKEN_KEY = "admin_token";
const USER_KEY = "admin_user";
const REQUIRED_ROLE = "ADMIN";

/** Fired in the CURRENT tab whenever the session changes (`storage` only fires in OTHER tabs). */
export const AUTH_CHANGED_EVENT = "space-transfer:admin-auth-changed";

export interface AuthUser {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

const notifyAuthChanged = () => {
  try {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {
    /* non-browser / test env */
  }
};

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

/**
 * Reads `exp` out of a JWT payload. Returns null when the token isn't a JWT or
 * carries no expiry — callers treat that as "can't prove it's expired" and let
 * it through, so a non-JWT session scheme can't lock everyone out. The server
 * remains the real authority; this is a client-side UX guard.
 */
function getTokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const exp = getTokenExpiry(token);
  if (exp === null) return false;
  // `exp` is in seconds; allow a small skew so a token isn't rejected a
  // moment early on a slightly fast clock.
  const SKEW_SECONDS = 30;
  return Date.now() / 1000 >= exp - SKEW_SECONDS;
}

/** True only for a present, unexpired token belonging to an ADMIN. */
export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token || isTokenExpired(token)) return false;
  const user = getUser();
  // Only enforce the role when we actually know it — an older session saved
  // before the role was persisted shouldn't be force-logged-out; the server
  // rejects it with a 401 anyway, which clears the session properly.
  if (user?.role && user.role !== REQUIRED_ROLE) return false;
  return true;
}

export function setAuth(token: string, user: AuthUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable (private mode) — session just won't persist */
  }
  notifyAuthChanged();
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  notifyAuthChanged();
}

/**
 * Subscribe to session changes. Covers this tab (custom event) and other tabs
 * (`storage`), so logging out in one tab immediately kicks the others out
 * instead of leaving a dead session on screen until a manual refresh.
 */
export function subscribeToAuth(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === TOKEN_KEY || e.key === USER_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(AUTH_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AUTH_CHANGED_EVENT, callback);
  };
}
