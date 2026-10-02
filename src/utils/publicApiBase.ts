/** What these helpers read from a request — an Express `Request` satisfies it. */
type RequestLike = { protocol?: string; get(name: string): unknown };

const header = (req: RequestLike, name: string): string => {
  const value = req.get(name);
  return (Array.isArray(value) ? value[0] : typeof value === "string" ? value : "") || "";
};

export const publicApiBase = (req: RequestLike): string | null => {
  const proto = (header(req, "x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  const host = (header(req, "x-forwarded-host") || header(req, "host")).split(",")[0].trim();
  return host ? `${proto}://${host}` : null;
};

/** An absolute link to a path this API serves, or the path itself when there is no host to use. */
export const apiFileUrl = (req: RequestLike, path: string): string => {
  const base = publicApiBase(req);
  return base ? `${base}${path}` : path;
};

export const resolveApiFile = (req: RequestLike, value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("/uploads/")) return apiFileUrl(req, value);
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/uploads/")) return apiFileUrl(req, url.pathname + url.search);
  } catch {
    /* not an absolute URL — fall through */
  }
  return value;
};
