import { clearAuth, getToken } from "./auth";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

/**
 * How long a request may take before it is given up on.
 *
 * There was no limit: a request that never answered left its spinner running
 * for good. 30 seconds covers any ordinary call; the slow ones pass their own
 * (`timeoutMs`) — AI edits, upscales, trims, placing an order.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

export type ApiFetchOptions = RequestInit & {
  /** Overrides the 30 s limit; 0 turns it off (callers with their own, e.g. uploads). */
  timeoutMs?: number;
};

const TIMEOUT_MESSAGE = "This is taking longer than it should. Please try again in a moment.";

/**
 * A request to the API, with a time limit.
 *
 * A read (GET) that times out or loses the connection is tried once more on
 * its own — the kind of blip that shouldn't reach the customer. Anything that
 * changes data is never retried automatically: placing an order twice is far
 * worse than being asked to press the button again.
 */
export async function apiFetch(endpoint: string, options: ApiFetchOptions = {}) {
  const isRead = !options.method || options.method.toUpperCase() === "GET";
  try {
    return await apiFetchOnce(endpoint, options);
  } catch (err: any) {
    if (!isRead || options.signal?.aborted || !(err?.network || err?.timeout)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return apiFetchOnce(endpoint, options);
  }
}

async function apiFetchOnce(endpoint: string, options: ApiFetchOptions) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const token = getToken();
  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  // Our own time limit, joined with any cancel the caller wired up.
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort);
  }
  const done = () => {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    done();
    if (timedOut) {
      console.warn(`[api] ${endpoint}: no answer within ${timeoutMs} ms`);
      throw Object.assign(new Error(TIMEOUT_MESSAGE), { timeout: true });
    }
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn(`[api] ${endpoint}: no response from ${API_BASE_URL}`, err);
    throw Object.assign(
      new Error("Can't connect to Space Transfers right now. Check your internet connection and try again."),
      { network: true },
    );
  }

  // Some error responses (auth gates) can return empty bodies; guard JSON.parse.
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    // A body cut off by the time limit is a timeout, not an empty answer.
    if (timedOut) {
      done();
      throw Object.assign(new Error(TIMEOUT_MESSAGE), { timeout: true });
    }
    data = null;
  } finally {
    done();
  }

  if (!response.ok) {
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
