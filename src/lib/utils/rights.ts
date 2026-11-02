import { apiFetch } from "./api";

/**
 * The rights check, from the store's side: the API checks images for
 * third-party brands, characters and works (see the API's rights services), and
 * the customer can dispute a result with Space Transfers.
 */

export type RightsVerdict = "clear" | "review" | "blocked" | "unchecked" | "pending";

export interface RightsFinding {
  id: string;
  label: string;
  kind?: string;
  severity: "block" | "review" | "info";
  detail?: string | null;
}

export interface ImageRights {
  url: string;
  verdict: RightsVerdict;
  findings: RightsFinding[];
  dispute?: { id: string; status: string };
  incomplete?: boolean;
  /** The image's screen: a crop and its original are one picture to the customer. */
  screenId?: string;
  /** The customer's own name for the image, when known. */
  name?: string;
}

export interface DisputeMessage {
  author: "CUSTOMER" | "ADMIN";
  authorName: string;
  body: string;
  attachments: { url: string; name: string }[];
  at: string;
}

export interface RightsDispute {
  id: string;
  imageUrl: string;
  imageName: string | null;
  status: "open" | "approved" | "rejected" | "withdrawn";
  findings: RightsFinding[];
  messages: DisputeMessage[];
  decision: { at: string; note: string; approvedFindings: string[] } | null;
  awaitingAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Whether an image is held: it can't go to checkout until removed or cleared. */
export const isHeld = (r?: { verdict?: string } | null) => r?.verdict === "review" || r?.verdict === "blocked" || r?.verdict === "unchecked";

/** The finding lines a customer is shown: everything that holds the image. */
export const heldFindings = (r?: { findings?: RightsFinding[] } | null) => (r?.findings || []).filter((f) => f.severity !== "info");

/**
 * The images an item stands for: what it prints, and the original it was made
 * from. A crop or a removed background keeps the original's brand but not its
 * file details, so both are judged, as the order does.
 */
export const itemImageUrls = (it: any): string[] => {
  const printed = typeof it?.croppedUrl === "string" && it.croppedUrl ? it.croppedUrl : it?.url;
  return [...new Set([printed, it?.originalUrl, it?.uncroppedUrl].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)))];
};

/** The images a cart prints, and their originals. */
export const printedUrls = (cartItems: any[]): string[] => {
  const urls = new Set<string>();
  for (const line of cartItems) {
    for (const it of Array.isArray(line?.items) ? line.items : []) itemImageUrls(it).forEach((u) => urls.add(u));
  }
  return [...urls];
};

/**
 * The held images in a cart, one per picture: an item's crop and its original
 * are the same image to the customer, and so are copies of it.
 */
export const heldByItem = (cartItems: any[], results: ImageRights[]): ImageRights[] => {
  const byUrl = new Map(results.map((r) => [r.url, r]));
  const seen = new Set<string>();
  const out: ImageRights[] = [];
  let n = 0;
  for (const line of cartItems) {
    for (const it of Array.isArray(line?.items) ? line.items : []) {
      n += 1;
      const held = itemImageUrls(it).map((u) => byUrl.get(u)).find((r): r is ImageRights => Boolean(r && isHeld(r)));
      if (!held) continue;
      const key = held.screenId || held.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...held, name: it.name || `Image ${n}` });
    }
  }
  // Anything held that no item claims still has to be shown.
  for (const r of results) {
    if (isHeld(r) && !seen.has(r.screenId || r.url) && !out.some((o) => o.url === r.url)) {
      seen.add(r.screenId || r.url);
      out.push(r);
    }
  }
  return out;
};

/** Names for those images, so a held one can be shown by the name the customer knows. */
export const printedNames = (cartItems: any[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const line of cartItems) {
    for (const it of Array.isArray(line?.items) ? line.items : []) {
      if (it?.name) itemImageUrls(it).forEach((u) => names.set(u, String(it.name)));
    }
  }
  return names;
};

export const checkArtworkRights = async (urls: string[], opts: { screen?: boolean } = {}): Promise<ImageRights[]> => {
  if (!urls.length) return [];
  const r = await apiFetch("/customer/rights/check", {
    method: "POST",
    body: JSON.stringify({ urls, screen: opts.screen !== false }),
    timeoutMs: 120_000,
  });
  return Array.isArray(r?.images) ? r.images : [];
};

/** The API's answer when payment or the order was refused over held artwork. */
export const rightsStopIn = (err: any): ImageRights[] | null =>
  err?.status === 409 && err?.data?.code === "RIGHTS_REVIEW" && Array.isArray(err.data.images) ? err.data.images : null;

export const listDisputes = async (): Promise<RightsDispute[]> => (await apiFetch("/customer/rights/disputes"))?.disputes || [];

export const getDispute = async (id: string): Promise<RightsDispute> => (await apiFetch(`/customer/rights/disputes/${encodeURIComponent(id)}`)).dispute;

export const openDispute = async (input: { imageUrl: string; imageName?: string; message: string; attachments: { url: string; name: string }[] }) =>
  (await apiFetch("/customer/rights/disputes", { method: "POST", body: JSON.stringify(input) })).dispute as RightsDispute;

export const replyToDispute = async (id: string, message: string, attachments: { url: string; name: string }[]) =>
  (await apiFetch(`/customer/rights/disputes/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ message, attachments }) }))
    .dispute as RightsDispute;

export const withdrawDispute = async (id: string) =>
  (await apiFetch(`/customer/rights/disputes/${encodeURIComponent(id)}/withdraw`, { method: "POST", body: "{}" })).dispute as RightsDispute;

export const uploadEvidence = async (file: File): Promise<{ url: string; name: string }> => {
  const form = new FormData();
  form.append("file", file);
  return apiFetch("/customer/rights/evidence", { method: "POST", body: form, timeoutMs: 120_000 });
};

/**
 * The readable copyright and source details of the file the customer chose,
 * read here because converting a PDF, PSD or HEIC drops them. XMP is plain
 * text inside the file; EXIF and IPTC strings are kept as found. The server
 * only ever uses this to add a finding, never to clear one.
 */
export const readSourceMetadata = async (file: File): Promise<string> => {
  try {
    const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
    let text = "";
    for (let i = 0; i < head.length; i++) {
      const c = head[i];
      text += c === 10 || (c >= 32 && c < 127) || c === 169 ? String.fromCharCode(c) : " ";
    }
    const xmp = /<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i.exec(text)?.[0] || "";
    const lines = text.match(/(?:©|copyright|credit|rights|getty|shutterstock|istock|adobe ?stock|alamy|depositphotos|dreamstime|123rf|freepik|vecteezy|envato)[^ ]{0,4}[ -~©]{0,120}/gi) || [];
    return [xmp.replace(/\s+/g, " "), ...lines].join("\n").slice(0, 20000);
  } catch {
    return "";
  }
};
