import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/utils/api";

/**
 * A lost connection used to read "Cannot reach the server. Check that it is
 * running at <API address>" — a developer's note on a customer's screen — and a
 * deliberate cancel (Stop, the upload timeout that retries) was swallowed into
 * that same message, so nothing could tell a cancel from an outage.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch when the connection fails", () => {
  it("says so in words for the customer, without the API address", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = await apiFetch("/customer/pricing").catch((e) => e);
    expect(error.message).toBe("Can't connect to Space Transfers right now. Check your internet connection and try again.");
    expect(error.message).not.toMatch(/localhost|http|running/);
    expect(error.network).toBe(true);
  });

  it("passes a deliberate cancel through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(apiFetch("/customer/pricing")).rejects.toMatchObject({ name: "AbortError" });
  });
});
