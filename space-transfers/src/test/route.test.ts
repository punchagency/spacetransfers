import { describe, expect, it } from "vitest";
import { LEGAL_PAGES, resolveRoute } from "../lib/route";
import { LEGAL_DOCUMENTS } from "../lib/legal/documents";

describe("store addresses", () => {
  it("open the editor at the root", () => {
    for (const p of ["/", "", "/index.html"]) expect(resolveRoute(p).kind).toBe("app");
  });

  it("open each legal document at the address the sign-up forms link to", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      const route = resolveRoute(doc.url);
      expect(route.kind).toBe("legal");
      if (route.kind === "legal") expect(route.docId).toBe(doc.id);
    }
    expect(resolveRoute("/legal/privacy/").kind).toBe("legal");
  });

  it("show not found for anything else", () => {
    for (const p of ["/checkout", "/legal", "/legal/unknown", "/admin", "/legal/terms/extra"]) expect(resolveRoute(p).kind).toBe("notFound");
  });

  it("list every legal page once", () => {
    expect(LEGAL_PAGES.map((p) => p.path)).toEqual(["/legal/terms", "/legal/privacy", "/legal/content-policy"]);
  });
});
