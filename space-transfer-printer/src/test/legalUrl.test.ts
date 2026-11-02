import { describe, expect, it } from "vitest";
import { storeOrigin } from "../utils/legal";

describe("where the legal documents are read", () => {
  it("is the configured store", () => {
    expect(storeOrigin("https://shop.example.com/", "https://partners.example.com")).toBe("https://shop.example.com");
  });

  it("is the store beside this app when none is configured", () => {
    expect(storeOrigin(undefined, "https://printer.stdemo.victoronojaodoh.com")).toBe("https://store.stdemo.victoronojaodoh.com");
    expect(storeOrigin("", "http://localhost:5175")).toBe("http://localhost:5175");
  });
});
