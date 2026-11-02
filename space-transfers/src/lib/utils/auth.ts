/**
 * Session handling for the store, in one place.
 *
 * The token was read and written by raw `localStorage` calls in eight separate
 * files, and signing out was duplicated in three of them. More importantly
 * `apiFetch` never looked at a 401: the session was only ever validated once, on
 * mount. If the token expired while someone was working — which is the common
 * case, since a gang sheet takes a while to build — every request failed, the UI
 * still showed them as signed in, and nothing said otherwise. Their work looked
 * like it was saving and was not.
 *
 * The printer and admin apps have had this shape for a while; the store is
 * matching it rather than inventing a third approach.
 */

const TOKEN_KEY = "token";

/** Fired when the session ends, so the app can drop back to signed-out. */
export const AUTH_CHANGED_EVENT = "st:auth_changed";

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing, or storage disabled — treat as signed out rather than
    // throwing out of every caller.
    return null;
  }
};

export const setToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* nothing useful to do; the session simply will not persist a reload */
  }
  notifyAuthChanged();
};

/**
 * End the session.
 *
 * `disableAutoSelect` stops Google silently signing the user straight back in on
 * the next page load, which would make signing out look broken.
 */
export const clearAuth = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  try {
    (window as unknown as { google?: any }).google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* GIS may not be loaded */
  }
  notifyAuthChanged();
};

const notifyAuthChanged = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
};

/** Subscribe to session changes, including sign-out in another tab. */
export const onAuthChanged = (callback: () => void): (() => void) => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === TOKEN_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(AUTH_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AUTH_CHANGED_EVENT, callback);
  };
};
