import { clearAuth, getToken } from "./auth";

/**
 * API base URL.
 *
 * Read from the environment so the same build works locally and in production —
 * this was previously hardcoded to localhost, which made every deployed build
 * call the operator's own machine. `.env.production` supplies the deployed value.
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
    throw new Error(
      `API server is not reachable. Check that the backend is running at ${API_BASE_URL}.`,
    );
  }

  // Auth gates and some error paths return empty bodies; guard JSON.parse so a
  // 401 with no body surfaces as an auth error rather than a parse error.
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    // The server is the real authority on the session. A 401 means the token is
    // gone/expired/revoked, so drop it — clearAuth notifies the route guard,
    // which redirects to /auth on its own.
    //
    // Note 403 is deliberately NOT treated this way: `PATCH /admin/profile/password`
    // returns 403 for a wrong *submitted* current password on an otherwise valid
    // session, and logging the admin out there would be wrong.
    if (response.status === 401) {
      clearAuth();
      throw new Error("Invalid or expired token");
    }
    throw new Error(data?.message || data?.error || "Something went wrong");
  }

  return data;
}

export const getApiBaseUrl = () => API_BASE_URL;
