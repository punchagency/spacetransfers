import { clearAuth, getToken } from "./auth";

/**
 * API base URL.
 *
 * Read from the environment so the same build works locally and in production —
 * this was previously hardcoded to localhost, which made every deployed build
 * call the operator's own machine. `.env.production` supplies the deployed value.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

/**
 * How long a request may take before it is given up on. There was no limit, so
 * a request that never answered left its spinner running for good. Callers
 * with slow work pass their own `timeoutMs`; 0 turns it off.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

export type ApiFetchOptions = RequestInit & { timeoutMs?: number };

export async function apiFetch(endpoint: string, fetchOptions: ApiFetchOptions = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = fetchOptions;
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  const callerSignal = options.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort);
  }
  try {
    return await apiFetchWithin(endpoint, { ...options, signal: controller.signal }, () => timedOut);
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

async function apiFetchWithin(endpoint: string, options: RequestInit, timedOut: () => boolean) {
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
  } catch (err) {
    if (timedOut()) {
      console.warn(`[api] ${endpoint}: no answer in time`);
      throw Object.assign(new Error("This is taking longer than it should. Please try again in a moment."), { timeout: true });
    }
    // A request the app cancelled on purpose (Stop, a timeout that retries) is
    // not a lost connection: pass it through so callers can tell. It used to be
    // swallowed into the message below.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // The detail is for whoever is debugging; the message is for the person
    // using the app. It used to name the API address and ask them to check the
    // backend was running.
    console.warn(`[api] ${endpoint}: no response from ${API_BASE_URL}`, err);
    throw Object.assign(
      new Error("Can't connect to Space Transfers right now. Check your internet connection and try again."),
      { network: true },
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
    // Signing in is the exception: a 401 there is a rejected *credential*, not a
    // dead session — there is no session yet. Clearing storage would be
    // meaningless, and reporting "invalid or expired token" to someone who just
    // mistyped their password explains nothing they can act on.
    //
    // Note 403 is deliberately NOT treated as a session failure either:
    // `PATCH /admin/profile/password` returns 403 for a wrong *submitted*
    // current password on an otherwise valid session, and logging the admin out
    // there would be wrong.
    if (response.status === 401 && !endpoint.startsWith("/auth/login")) {
      clearAuth();
      throw new Error(data?.message || "Your session has expired. Please sign in again.");
    }
    throw new Error(data?.message || data?.error || "Something went wrong");
  }

  return data;
}

export const getApiBaseUrl = () => API_BASE_URL;
