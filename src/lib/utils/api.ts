import { clearAuth, getToken } from "./auth";

/*
 * Falls back to localhost, like the printer and admin apps.
 *
 * This defaulted to a hard-coded Heroku host, which now answers 404. With
 * `.env` present that never showed — but a fresh clone or a CI run without it
 * would silently talk to a dead remote server, and the failure would read as
 * "the app is broken" rather than "VITE_API_URL is not set".
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
  } catch {
    // A network failure threw a bare "Failed to fetch", which names nothing the
    // user or we can act on.
    throw new Error(`Cannot reach the server. Check that it is running at ${API_BASE_URL}.`);
  }

  // Some error responses (auth gates) can return empty bodies; guard JSON.parse.
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    /*
     * The server is the authority on the session. A 401 means the token is
     * gone, expired or revoked, so drop it and let the app fall back to
     * signed-out — previously nothing did this, so an expired token left
     * someone apparently signed in with every request failing.
     *
     * Signing in is the exception: a 401 there is a rejected credential, not a
     * dead session, and clearing storage would be meaningless.
     */
    const isAuthAttempt =
      endpoint.startsWith("/auth/login") ||
      endpoint.startsWith("/auth/register") ||
      endpoint.startsWith("/auth/google");

    if (response.status === 401 && !isAuthAttempt) {
      clearAuth();
      const expired: Error & { status?: number; data?: any } = new Error(
        "Your session has expired. Please sign in again.",
      );
      expired.status = 401;
      expired.data = data;
      throw expired;
    }

    const error: Error & { status?: number; data?: any } = new Error(
      data?.message || `Request failed with status ${response.status}`,
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * The API origin, for the few calls that cannot go through `apiFetch` — a blob
 * download, or an XHR that reports upload progress.
 *
 * Two invoice downloads hard-coded `http://localhost:4000/api`, so they worked
 * only on a developer's machine and would have failed in production with a
 * bare "Failed to download invoice".
 */
export const getApiBaseUrl = () => API_BASE_URL;
