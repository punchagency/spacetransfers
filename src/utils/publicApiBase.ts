/** What these helpers read from a request — an Express `Request` satisfies it. */
type RequestLike = { protocol?: string; get(name: string): unknown };

const header = (req: RequestLike, name: string): string => {
  const value = req.get(name);
  return (Array.isArray(value) ? value[0] : typeof value === "string" ? value : "") || "";
};

/**
 * The address this API is reached at, for links to files it serves itself.
 *
 * Print files, previews and download bundles live under `/uploads` and
 * `/api/...` on the API — so a link to one must use the API's own public
 * address. Those links used to be built from `APP_URL`, which is the customer
 * store's address (the password-reset and welcome links need it to be). Two
 * meanings, one variable, no correct value: with the store and the API on
 * separate hosts every preview a print partner opened loaded the store's page
 * instead of the image, and the browser blocked it ("Preview failed to load").
 * It only worked in development because `localhost` fell through to this.
 *
 * Taken from the request instead, which always arrived at the API. Behind a
 * proxy (Caddy, Render) the forwarded headers carry the public scheme and host;
 * `trust proxy` is set in app.ts.
 */
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

/**
 * A stored link to a file this API serves, made correct for the current request.
 *
 * Order previews used to be saved as absolute URLs, so the host of the day was
 * baked into the record: orders placed while the API ran locally point at
 * `http://localhost:4000`, and one placed on the demo points at the store. Now
 * only the path is stored; this puts the current API address in front of it —
 * and re-bases the older absolute ones, so they work without a data migration
 * and keep working when the site moves to another domain.
 *
 * Anything that isn't an `/uploads/` file (an artwork URL in storage, a data
 * URL) is returned as it is.
 */
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
