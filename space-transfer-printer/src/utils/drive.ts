type DriveToken = {
  accessToken: string;
  expiresAt: number;
};

declare global {
  interface Window {
    google?: any;
  }
}

const TOKEN_STORAGE_KEY = "drive_oauth_token_v1";

const nowMs = () => Date.now();

const loadGis = () =>
  new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google auth script")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google auth script"));
    document.head.appendChild(s);
  });

const getStoredToken = (): DriveToken | null => {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken || !parsed?.expiresAt) return null;
    return { accessToken: String(parsed.accessToken), expiresAt: Number(parsed.expiresAt) };
  } catch {
    return null;
  }
};

/** A saved Drive connection that is still good, without asking Google. */
export const getSavedDriveToken = (): string | null => {
  const stored = getStoredToken();
  return stored && stored.expiresAt - nowMs() > 60_000 ? stored.accessToken : null;
};

const storeToken = (t: DriveToken) => {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(t));
};

export const getGoogleDriveAccessToken = async ({
  clientId,
  prompt,
}: {
  clientId: string;
  prompt?: "" | "consent";
}): Promise<string> => {
  const stored = getStoredToken();
  if (stored && stored.expiresAt - nowMs() > 60_000) return stored.accessToken;

  await loadGis();

  const token = await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2?.initTokenClient) {
      reject(new Error("Google OAuth not available"));
      return;
    }

    /*
     * Google reports a blocked or closed popup through `error_callback`, not
     * `callback`. With only the latter, a popup the browser blocked left the
     * promise — and the "Connecting to Google Drive…" spinner — waiting forever.
     */
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (resp: any) => {
        if (resp?.error) reject(new Error(String(resp.error_description || resp.error)));
        else resolve(resp);
      },
      error_callback: (err: any) => {
        const type = String(err?.type || "");
        reject(
          new Error(
            type === "popup_failed_to_open"
              ? "Your browser blocked the Google window. Allow pop-ups for this site and try again."
              : type === "popup_closed"
                ? "The Google window was closed before Drive was connected."
                : "Google Drive couldn't be connected. Please try again.",
          ),
        );
      },
    });

    client.requestAccessToken({ prompt: prompt ?? "" });
  });

  const next: DriveToken = {
    accessToken: String(token.access_token),
    expiresAt: nowMs() + Number(token.expires_in || 0) * 1000,
  };
  storeToken(next);
  return next.accessToken;
};

type DriveFolder = { id: string; name: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const withBackoff = async <T>(fn: () => Promise<T>, maxAttempts = 6) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      attempt += 1;
      const status = Number(e?.status || 0);
      if (attempt >= maxAttempts || (status && status < 429)) throw e;
      const base = Math.min(10_000, 500 * 2 ** (attempt - 1));
      const jitter = Math.round(Math.random() * 250);
      await sleep(base + jitter);
    }
  }
};

const queue: Array<() => void> = [];
let active = 0;
const CONCURRENCY = 2;

const runQueued = () => {
  if (active >= CONCURRENCY) return;
  const next = queue.shift();
  if (!next) return;
  active += 1;
  next();
};

const driveFetch = async (
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> => {
  return await new Promise<Response>((resolve, reject) => {
    queue.push(() => {
      fetch(input, init)
        .then((res) => {
          active -= 1;
          runQueued();
          resolve(res);
        })
        .catch((err) => {
          active -= 1;
          runQueued();
          reject(err);
        });
    });
    runQueued();
  });
};

const driveJson = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || "Drive API error");
  }
};

export const listGoogleDriveFolders = async (accessToken: string): Promise<DriveFolder[]> => {
  const folders: DriveFolder[] = [];
  let pageToken: string | null = null;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("q", "mimeType='application/vnd.google-apps.folder' and trashed=false");
    qs.set("fields", "files(id,name),nextPageToken");
    qs.set("pageSize", "50");
    if (pageToken) qs.set("pageToken", pageToken);

    const res = await withBackoff(async () => {
      const r = await driveFetch(`https://www.googleapis.com/drive/v3/files?${qs.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.status === 429) {
        const err: any = new Error("rate_limited");
        err.status = 429;
        throw err;
      }
      if (!r.ok) {
        const err: any = new Error("drive_list_failed");
        err.status = r.status;
        throw err;
      }
      return r;
    });

    const data = await driveJson<{ files?: Array<{ id: string; name: string }>; nextPageToken?: string }>(res);
    (data.files || []).forEach((f) => folders.push({ id: String(f.id), name: String(f.name) }));
    pageToken = data.nextPageToken ? String(data.nextPageToken) : null;
    if (!pageToken) break;
  }

  return folders.sort((a, b) => a.name.localeCompare(b.name));
};

export const createResumableUploadSession = async ({
  accessToken,
  fileName,
  mimeType,
  folderId,
}: {
  accessToken: string;
  fileName: string;
  mimeType: string;
  folderId: string | null;
}): Promise<string> => {
  const metadata: any = { name: fileName };
  if (folderId) metadata.parents = [folderId];

  const res = await withBackoff(async () => {
    const r = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify(metadata),
    });
    if (r.status === 429) {
      const err: any = new Error("rate_limited");
      err.status = 429;
      throw err;
    }
    if (!r.ok) {
      const err: any = new Error("drive_session_failed");
      err.status = r.status;
      throw err;
    }
    return r;
  });

  const uploadUrl = res.headers.get("location");
  if (!uploadUrl) throw new Error("drive_session_missing_location");
  return uploadUrl;
};

export const uploadBlobResumable = async ({
  accessToken,
  uploadUrl,
  blob,
  chunkSizeBytes = 5 * 1024 * 1024,
  onProgress,
  signal,
}: {
  accessToken: string;
  uploadUrl: string;
  blob: Blob;
  chunkSizeBytes?: number;
  onProgress?: (p: { loaded: number; total: number }) => void;
  signal?: AbortSignal;
}): Promise<string> => {
  const total = blob.size;
  let offset = 0;

  while (offset < total) {
    const end = Math.min(total, offset + chunkSizeBytes);
    const chunk = blob.slice(offset, end);
    const res = await withBackoff(async () => {
      const r = await driveFetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Length": String(chunk.size),
          "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
        },
        body: chunk,
        signal,
      });
      if (r.status === 429) {
        const err: any = new Error("rate_limited");
        err.status = 429;
        throw err;
      }
      if (r.status >= 500) {
        const err: any = new Error("drive_upload_retryable");
        err.status = r.status;
        throw err;
      }
      return r;
    });

    if (res.status === 308) {
      offset = end;
      onProgress?.({ loaded: offset, total });
      continue;
    }

    if (res.ok) {
      const data = await driveJson<{ id?: string }>(res);
      const id = data?.id ? String(data.id) : "";
      if (!id) throw new Error("drive_upload_missing_id");
      onProgress?.({ loaded: total, total });
      return id;
    }

    throw new Error("drive_upload_failed");
  }

  throw new Error("drive_upload_failed");
};

export const getDriveFileWebViewLink = async (accessToken: string, fileId: string): Promise<string> => {
  const res = await withBackoff(async () => {
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=webViewLink`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.status === 429) {
      const err: any = new Error("rate_limited");
      err.status = 429;
      throw err;
    }
    if (!r.ok) {
      const err: any = new Error("drive_link_failed");
      err.status = r.status;
      throw err;
    }
    return r;
  });

  const data = await driveJson<{ webViewLink?: string }>(res);
  const link = data?.webViewLink ? String(data.webViewLink) : "";
  return link || `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
};
