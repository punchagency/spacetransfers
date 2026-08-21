import { clearAuth, getToken } from "./auth";
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
    throw new Error(`API server is not reachable. Check that the backend is running at ${API_BASE_URL}.`);
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    // The server is the real authority on the session. A 401 means the token is
    // gone/expired/revoked, so drop it — clearAuth notifies the route guard,
    // which redirects to /auth on its own. No window.location reload needed
    // (that threw away in-flight React state and flashed the whole app).
    // Signing in is the exception: a 401 there is a rejected *credential*, not a
    // dead session — there is no session yet. Clearing storage would be
    // meaningless, and reporting "invalid or expired token" to someone who just
    // mistyped their password explains nothing they can act on.
    if (response.status === 401 && !endpoint.startsWith("/auth/login")) {
      clearAuth();
      throw new Error(data?.message || "Your session has expired. Please sign in again.");
    }
    throw new Error(data?.message || "Something went wrong");
  }

  return data;
}

export const getApiBaseUrl = () => API_BASE_URL;

const parseContentDispositionFilename = (value: string | null) => {
  if (!value) return null;
  const m = value.match(/filename\*?=(?:UTF-8''|")?([^\";]+)"?/i);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
};

export async function fetchBlobWithProgress(
  url: string,
  options: RequestInit & { onProgress?: (p: { loaded: number; total: number | null }) => void } = {},
) {
  const { onProgress, ...init } = options;
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = "Download failed";
    try {
      const data = await res.json();
      msg = data?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : null;
  const filename =
    parseContentDispositionFilename(res.headers.get("content-disposition")) ||
    null;
  const contentType = res.headers.get("content-type") || "application/octet-stream";

  if (!res.body) {
    const blob = await res.blob();
    onProgress?.({ loaded: blob.size, total: total ?? blob.size });
    return { blob, filename, contentType };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const chunk = new Uint8Array(value);
      chunks.push(chunk);
      loaded += chunk.byteLength;
      onProgress?.({ loaded, total });
    }
  }

  const blob = new Blob(chunks as unknown as BlobPart[], { type: contentType });
  onProgress?.({ loaded: blob.size, total });
  return { blob, filename, contentType };
}

export const saveBlobToDisk = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/**
 * Trigger a native browser download for an authenticated endpoint. The response
 * streams straight to disk via the browser's own download manager, so large
 * files (multi-hundred-MB split-gangsheet zips, asset bundles) download reliably
 * instead of being buffered into page memory and rebuilt as a Blob — which
 * truncated big files and produced corrupt, un-expandable zips.
 *
 * The token rides in the query string because a native download cannot set an
 * Authorization header; the server names the file via Content-Disposition.
 */
export const triggerAuthedDownload = (url: string) => {
  const token = getToken();
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = token ? `${url}${sep}token=${encodeURIComponent(token)}` : url;
  const a = document.createElement("a");
  a.href = fullUrl;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};
