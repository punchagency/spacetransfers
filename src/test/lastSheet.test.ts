import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLastSheet, sheetToReopen, writeLastSheet } from "../lib/utils/lastSheet";

describe("reopening the last sheet", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reopens the sheet that was open", () => {
    writeLastSheet("u1", "sheet-a");
    expect(sheetToReopen(readLastSheet("u1"), "sheet-b")).toBe("sheet-a");
  });

  it("stays blank after the customer started a new sheet", () => {
    writeLastSheet("u1", null);
    expect(readLastSheet("u1")).toBe("");
    expect(sheetToReopen(readLastSheet("u1"), "sheet-b")).toBeNull();
  });

  it("opens the most recently saved sheet on a browser that remembers nothing", () => {
    expect(readLastSheet("u1")).toBeNull();
    expect(sheetToReopen(null, "sheet-b")).toBe("sheet-b");
    expect(sheetToReopen(null, null)).toBeNull();
  });

  it("is kept per account", () => {
    writeLastSheet("u1", "sheet-a");
    expect(readLastSheet("u2")).toBeNull();
  });
});
