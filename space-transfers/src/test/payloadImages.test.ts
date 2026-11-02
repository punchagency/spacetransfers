import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression coverage for the 413 on PUT /cart and POST /orders.
 *
 * Canvas results (auto-crop, background removal, AI edits) are base64 data URLs
 * of several megabytes, written onto every artboard item's `url` and
 * `croppedUrl`. A realistic sheet exceeded the 50 MB body limit before the
 * captured thumbnail was even counted.
 */
/**
 * The uploader posts binary now, not base64 JSON — it decodes the data URL with
 * `fetch(url).blob()`, which jsdom cannot do for multi-megabyte payloads (it
 * exhausts the worker heap). Stubbed to return a Blob whose size reflects the
 * decoded bytes, which is all the module needs.
 */
vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
  blob: async () => ({ size: Math.floor((url.length - 22) * 3 / 4), type: "image/png" }) as any,
})));

let uploadSeq = 0;
vi.mock("../lib/utils/api", () => ({
  apiFetch: vi.fn(async () => ({
    url: `https://res.cloudinary.com/demo/image/upload/v1/edited/${uploadSeq++}.png`,
    materialized: true,
  })),
}));

import {
  stripEmbeddedImages,
  payloadBytes,
  toHostedUrl,
  hasEmbeddedImages,
  isRetryable,
  toCustomerMessage,
} from "../lib/utils/payloadImages";
import { apiFetch } from "../lib/utils/api";

/** ~5 MB PNG becomes ~6.7 MB of base64 — a realistic edited artwork. */
const artwork = (mb = 5, salt = "") =>
  `data:image/png;base64,${salt}${"A".repeat(Math.round(mb * 1024 * 1024 * 4 / 3))}`;

const cartRow = (id: number, imageCount: number) => ({
  id, name: "Gang Sheet", type: "gangsheet", price: 42, widthIn: 22, heightIn: 40, copies: 1,
  image: artwork(2.5, `sheet${id}`),
  items: Array.from({ length: imageCount }, (_, i) => {
    const src = artwork(5, `img${id}-${i}`);
    return { id: i, url: src, croppedUrl: src, originalUrl: "https://cdn/x.png",
             widthIn: 5, heightIn: 5, posX: 0, posY: 0, copies: 1 };
  }),
});

const EXPRESS_LIMIT = 50 * 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/customer/cart", () => {
  it("exceeded the 50 MB body limit before the fix", () => {
    const before = { cart: [cartRow(1, 8)] };
    expect(payloadBytes(before)).toBeGreaterThan(EXPRESS_LIMIT);
  });

  it("is kilobytes after the fix", async () => {
    const after = await stripEmbeddedImages({ cart: [cartRow(1, 8)] });
    expect(payloadBytes(after)).toBeLessThan(20_000);
  });

  it("stays small as the cart grows — size no longer scales with images", async () => {
    // The property that matters: the payload is now flat in image count/size.
    const small = payloadBytes(await stripEmbeddedImages({ cart: [cartRow(1, 8)] }));
    const large = payloadBytes(await stripEmbeddedImages({ cart: [cartRow(1, 40), cartRow(2, 40)] }));
    expect(large).toBeLessThan(EXPRESS_LIMIT);
    expect(large).toBeLessThan(small * 12);
  });

  it("preserves every non-image field", async () => {
    const [row] = (await stripEmbeddedImages({ cart: [cartRow(7, 3)] })).cart;
    expect(row.id).toBe(7);
    expect(row.price).toBe(42);
    expect(row.items).toHaveLength(3);
    expect(row.items[0].widthIn).toBe(5);
    expect(row.items[0].posX).toBe(0);
  });

  it("replaces embedded images with hosted URLs, not blanks", async () => {
    // Blanking would lose the artwork — the print file must still resolve.
    const [row] = (await stripEmbeddedImages({ cart: [cartRow(1, 2)] })).cart;
    for (const item of row.items) {
      expect(item.url.startsWith("https://")).toBe(true);
      expect(item.croppedUrl.startsWith("https://")).toBe(true);
    }
    expect(row.image.startsWith("https://")).toBe(true);
  });
});

describe("POST /api/customer/orders", () => {
  const orderPayload = () => ({
    items: [{
      name: "Gang Sheet", quantity: 1, unitPrice: 42,
      previewImage: artwork(2.5, "preview"),
      artboardItems: Array.from({ length: 8 }, (_, i) => ({
        id: i, assetId: "a", croppedUrl: artwork(5, `o${i}`), widthIn: 5, heightIn: 5, posX: 0, posY: 0,
      })),
    }],
    customer: { firstName: "A", lastName: "B", email: "a@b.c" },
    pricing: { subtotal: 42, total: 51 },
  });

  it("exceeded the limit before, fits comfortably after", async () => {
    expect(payloadBytes(orderPayload())).toBeGreaterThan(EXPRESS_LIMIT);
    const after = await stripEmbeddedImages(orderPayload());
    expect(payloadBytes(after)).toBeLessThan(20_000);
  });

  it("keeps pricing and customer data intact", async () => {
    const after = await stripEmbeddedImages(orderPayload());
    expect(after.pricing.total).toBe(51);
    expect(after.customer.email).toBe("a@b.c");
    expect(after.items[0].artboardItems).toHaveLength(8);
  });
});

describe("efficiency", () => {
  it("uploads each distinct image once, not once per reference", async () => {
    // url and croppedUrl are the same string on every item, so 4 items
    // referencing 4 distinct images must cost 4 uploads, not 8.
    await stripEmbeddedImages({ cart: [cartRow(99, 4)] });
    // 4 artwork + 1 sheet capture
    expect(vi.mocked(apiFetch).mock.calls.length).toBe(5);
  });

  it("leaves hosted URLs alone — no needless round trips", async () => {
    const payload = { cart: [{ id: 1, items: [{ url: "https://cdn/a.png", croppedUrl: "https://cdn/b.png" }] }] };
    const after = await stripEmbeddedImages(payload);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    expect(after).toEqual(payload);
  });

  it("ignores data URLs too small to matter", async () => {
    await stripEmbeddedImages({ cart: [{ id: 1, image: "data:image/png;base64,AAAA" }] });
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it("does not mutate the caller's payload", async () => {
    // A failed submit must leave state retryable.
    const original = { cart: [cartRow(1, 2)] };
    const snapshot = original.cart[0].items[0].url;
    await stripEmbeddedImages(original);
    expect(original.cart[0].items[0].url).toBe(snapshot);
  });

  it("surfaces an upload failure instead of silently dropping artwork", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ url: null });
    await expect(toHostedUrl(artwork(5, "fail"))).rejects.toThrow(/could not be uploaded/i);
  });
});

/**
 * Regression coverage for the Place Order flow surfacing a raw internal error
 * verbatim to the customer.
 *
 * `stripEmbeddedImages` (called from `CheckoutModal.placeOrder` as a safety
 * net) calls `toHostedUrl`, whose materialize request is the exact one that
 * produced:
 *
 *     {"message":"File size too large. Got 26109039. Maximum is 10485760."}
 *
 * `apiFetch` throws `data.message` verbatim, and the checkout UI's catch
 * block does `toast.error(err.message || ...)` — so whatever `toHostedUrl`
 * throws is shown to the customer exactly as written, with no other
 * classification in between. That is what these tests pin: a 5xx (which can
 * carry a vendor's raw wording) must never surface directly, a 4xx (worded by
 * our own server for a customer) must, and the endpoint's own 20s timeout
 * ceiling turns a stuck call into an honest, bounded failure instead of the
 * unbounded 54-second hang reported in production.
 */
describe("toHostedUrl error classification and retry", () => {
  const httpError = (status: number, message: string) => {
    const error = new Error(message) as Error & { status: number };
    error.status = status;
    return error;
  };

  it("retries once on a 5xx and succeeds if the retry works", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(
      httpError(500, "File size too large. Got 26109039. Maximum is 10485760."),
    );
    const url = await toHostedUrl(artwork(5, "retry-success"));
    expect(url.startsWith("https://")).toBe(true);
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2);
  });

  it("never shows the customer a raw 5xx message, even after both attempts fail", async () => {
    const raw = "File size too large. Got 26109039. Maximum is 10485760.";
    vi.mocked(apiFetch)
      .mockRejectedValueOnce(httpError(500, raw))
      .mockRejectedValueOnce(httpError(500, raw));

    await expect(toHostedUrl(artwork(5, "double-fail"))).rejects.toThrow(
      /couldn't be uploaded right now/i,
    );
    // The exact assertion: Cloudinary's internal wording must not appear
    // anywhere in what the customer sees.
    try {
      await toHostedUrl(artwork(5, "double-fail-2"));
    } catch (err: any) {
      expect(err.message).not.toContain("26109039");
      expect(err.message).not.toContain("10485760");
    }
  });

  it("does not retry a 4xx — the server's own customer-facing message is shown as-is", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(
      httpError(400, "That image is too large to process. Please re-export it at a smaller size."),
    );
    await expect(toHostedUrl(artwork(5, "validation-fail"))).rejects.toThrow(
      /re-export it at a smaller size/i,
    );
    // One call, not two — retrying an identical request against a 4xx would
    // fail identically and only add latency.
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it("retries a raw network failure (fetch itself throwing) once", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const url = await toHostedUrl(artwork(5, "network-blip"));
    expect(url.startsWith("https://")).toBe(true);
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2);
  });
});

describe("isRetryable", () => {
  it("retries a 5xx", () => {
    const e = new Error("boom") as any;
    e.status = 503;
    expect(isRetryable(e)).toBe(true);
  });

  it("does not retry a 4xx", () => {
    const e = new Error("bad request") as any;
    e.status = 404;
    expect(isRetryable(e)).toBe(false);
  });

  it("retries an AbortError (the materialize timeout firing)", () => {
    expect(isRetryable(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("retries a raw network TypeError", () => {
    expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("retries a lost connection as apiFetch reports it", () => {
    expect(isRetryable(Object.assign(new Error("Can't connect"), { network: true }))).toBe(true);
  });

  it("does not retry our own deliberately-thrown client error", () => {
    // No status, not a TypeError — e.g. materializeOnce's "no url in response".
    expect(isRetryable(new Error("The edited image could not be uploaded."))).toBe(false);
  });
});

describe("toCustomerMessage", () => {
  it("passes a 4xx message through unchanged", () => {
    const e = new Error("Please re-export it at a smaller size.") as any;
    e.status = 400;
    expect(toCustomerMessage(e)).toBe("Please re-export it at a smaller size.");
  });

  it("replaces a 5xx message rather than showing it", () => {
    const e = new Error("File size too large. Got 26109039. Maximum is 10485760.") as any;
    e.status = 500;
    const message = toCustomerMessage(e);
    expect(message).not.toContain("26109039");
    expect(message).toMatch(/try again/i);
  });

  it("replaces a raw network TypeError's message", () => {
    const message = toCustomerMessage(new TypeError("Failed to fetch"));
    expect(message).not.toBe("Failed to fetch");
    expect(message).toMatch(/try again/i);
  });

  it("passes our own client-thrown message through unchanged", () => {
    const message = toCustomerMessage(new Error("The edited image could not be uploaded. Please try again."));
    expect(message).toBe("The edited image could not be uploaded. Please try again.");
  });
});

describe("hasEmbeddedImages", () => {
  it("finds a top-level embedded image", () => {
    expect(hasEmbeddedImages({ image: artwork(1, "top") })).toBe(true);
  });

  it("finds an image nested inside arrays and objects", () => {
    expect(
      hasEmbeddedImages({ cart: [{ items: [{ url: artwork(1, "nested") }] }] }),
    ).toBe(true);
  });

  it("returns false when every reference is already hosted", () => {
    expect(
      hasEmbeddedImages({ cart: [{ items: [{ url: "https://cdn/a.png" }] }] }),
    ).toBe(false);
  });

  it("returns false for a data URL too small to matter", () => {
    expect(hasEmbeddedImages({ image: "data:image/png;base64,AAAA" })).toBe(false);
  });

  it("returns false for an empty or primitive payload", () => {
    expect(hasEmbeddedImages(null)).toBe(false);
    expect(hasEmbeddedImages({})).toBe(false);
    expect(hasEmbeddedImages([])).toBe(false);
  });

  it("agrees with stripEmbeddedImages about whether there is anything to do", async () => {
    const withArt = { cart: [cartRow(1, 1)] };
    const withoutArt = { cart: [{ id: 1, items: [{ url: "https://cdn/a.png" }] }] };

    expect(hasEmbeddedImages(withArt)).toBe(true);
    expect(hasEmbeddedImages(withoutArt)).toBe(false);

    vi.mocked(apiFetch).mockClear();
    await stripEmbeddedImages(withoutArt);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });
});
