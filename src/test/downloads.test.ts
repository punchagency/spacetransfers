import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { downloadOrderInvoice } from "../utils/downloads";
import { setAuth, clearAuth } from "../utils/auth";

/**
 * The first version of this read `localStorage.getItem("token")`, copied from
 * the storefront. This app stores the token under `admin_token`, so the
 * Authorization header went out empty and every download answered
 * "Authentication required".
 *
 * Nothing could catch that: it type-checks, it lints, it builds. Only a request
 * shows it.
 */

const jwt = (expSecondsFromNow: number) =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }))}.s`;

const pdf = () =>
  new Response(new Blob(["%PDF-1.3"], { type: "application/pdf" }), {
    status: 200,
    headers: { "Content-Disposition": 'attachment; filename="invoice-DTF-0241.pdf"' },
  });

let clicked: { href: string; download: string } | null = null;

beforeEach(() => {
  localStorage.clear();
  clicked = null;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
  globalThis.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked = { href: this.href, download: this.download };
  });
});

afterEach(() => {
  clearAuth();
  vi.restoreAllMocks();
});

describe("downloadOrderInvoice", () => {
  it("sends the token this app actually stores", async () => {
    setAuth(jwt(3600), { id: "1", name: "A", email: "a@b.c", role: "ADMIN" } as any);
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => pdf(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await downloadOrderInvoice("order-1", "DTF-0241");

    const init = fetchMock.mock.calls[0][1];
    const auth = (init?.headers ?? {}) as Record<string, string>;
    expect(auth.Authorization).toMatch(/^Bearer .+/);
    // The exact failure that was reported: no header at all.
    expect(auth.Authorization).not.toBe("Bearer null");
    expect(auth.Authorization).not.toBe("Bearer undefined");
  });

  it("requests the invoice for the right order", async () => {
    setAuth(jwt(3600), { id: "1", name: "A", email: "a@b.c", role: "ADMIN" } as any);
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => pdf(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await downloadOrderInvoice("abc123", "DTF-0241");

    expect(String(fetchMock.mock.calls[0][0])).toContain("/admin/orders/abc123/invoice");
  });

  it("saves under the filename the server supplied", async () => {
    setAuth(jwt(3600), { id: "1", name: "A", email: "a@b.c", role: "ADMIN" } as any);
    vi.stubGlobal("fetch", vi.fn(async () => pdf()));

    await downloadOrderInvoice("order-1", "DTF-9999");

    expect(clicked?.download).toBe("invoice-DTF-0241.pdf");
  });

  it("falls back to the order number when the server sends no filename", async () => {
    setAuth(jwt(3600), { id: "1", name: "A", email: "a@b.c", role: "ADMIN" } as any);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(new Blob(["%PDF"], { type: "application/pdf" }), { status: 200 }),
    ));

    await downloadOrderInvoice("order-1", "DTF-0241");

    expect(clicked?.download).toBe("invoice-DTF-0241.pdf");
  });

  it("surfaces the server's message instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ message: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await expect(downloadOrderInvoice("order-1")).rejects.toThrow("Authentication required");
  });

  it("still throws something useful when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(downloadOrderInvoice("order-1")).rejects.toThrow(/500/);
  });
});
