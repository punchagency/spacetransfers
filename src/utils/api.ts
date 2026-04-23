const API_BASE_URL = "http://localhost:4000/api";

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem("printer_token");
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
    throw new Error("API server is not reachable. Start the backend on http://localhost:4000.");
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      try {
        localStorage.removeItem("printer_token");
        localStorage.removeItem("printer_user");
      } catch {}
      if (window.location.pathname !== "/auth") {
        window.location.href = "/auth";
      }
      throw new Error("Invalid or expired token");
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
