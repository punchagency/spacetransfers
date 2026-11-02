import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import RightsCenter from "../components/rights/RightsCenter";
import { openRightsCenter } from "../lib/rightsCenter";
import { heldByItem, isHeld, printedNames, printedUrls, rightsStopIn } from "../lib/utils/rights";

vi.mock("../lib/utils/api", () => ({ apiFetch: vi.fn(async () => ({ disputes: [] })) }));

/**
 * The store's side of the rights check: which images a cart prints, what holds
 * checkout, and the panel that explains it and lets the customer dispute.
 */
describe("rights helpers", () => {
  const cart = [
    { items: [{ url: "https://cdn/a.png", croppedUrl: "https://cdn/a-crop.png", name: "Logo.png" }, { url: "https://cdn/b.png", name: "Cat.png" }] },
    { items: [{ url: "https://cdn/b.png" }] },
  ];

  it("lists each printed image once: the crop when there is one, as the order records it", () => {
    expect(printedUrls(cart)).toEqual(["https://cdn/a-crop.png", "https://cdn/b.png"]);
    expect(printedNames(cart).get("https://cdn/a-crop.png")).toBe("Logo.png");
  });

  it("judges an item by its print and its original, and lists each held picture once", () => {
    const items = [
      { items: [{ url: "https://cdn/t1.png", croppedUrl: "https://cdn/t1.png", originalUrl: "https://cdn/o1.png" }, { url: "https://cdn/t1.png", originalUrl: "https://cdn/o1.png" }] },
      { items: [{ url: "https://cdn/c.png", name: "Clean.png" }] },
    ];
    expect(printedUrls(items)).toEqual(["https://cdn/t1.png", "https://cdn/o1.png", "https://cdn/c.png"]);
    const results = [
      { url: "https://cdn/t1.png", verdict: "clear" as const, findings: [], screenId: "s1" },
      { url: "https://cdn/o1.png", verdict: "review" as const, findings: [], screenId: "s1" },
      { url: "https://cdn/c.png", verdict: "clear" as const, findings: [], screenId: "s2" },
    ];
    expect(heldByItem(items, results).map((h) => [h.url, h.name])).toEqual([["https://cdn/o1.png", "Image 1"]]);
  });

  it("holds images that are blocked, under review, or couldn't be checked", () => {
    expect(isHeld({ verdict: "blocked" })).toBe(true);
    expect(isHeld({ verdict: "review" })).toBe(true);
    expect(isHeld({ verdict: "unchecked" })).toBe(true);
    expect(isHeld({ verdict: "clear" })).toBe(false);
    expect(isHeld({ verdict: "pending" })).toBe(false);
  });

  it("reads the images out of a payment the API refused over rights, and nothing else", () => {
    const images = [{ url: "https://cdn/a.png", verdict: "blocked", findings: [] }];
    expect(rightsStopIn({ status: 409, data: { code: "RIGHTS_REVIEW", images } })).toEqual(images);
    expect(rightsStopIn({ status: 409, data: { code: "OTHER" } })).toBeNull();
    expect(rightsStopIn(new Error("boom"))).toBeNull();
  });
});

describe("RightsCenter", () => {
  it("opens on request, explains a paused checkout, and offers a dispute only when signed in", async () => {
    render(<RightsCenter />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      openRightsCenter({
        reason: "checkout",
        images: [{ url: "https://cdn/a.png", verdict: "blocked", name: "Logo.png", findings: [{ id: "ip:nike", label: "Nike (logo)", severity: "block" }] }],
      });
    });
    expect(screen.getByRole("dialog", { name: "Rights reviews" })).toBeInTheDocument();
    expect(screen.getByText("Checkout is paused for these images")).toBeInTheDocument();
    expect(screen.getByText("Nike (logo)")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    // Signed out in this test: disputing needs an account.
    expect(screen.getByText("Sign in to dispute this result.")).toBeInTheDocument();
  });
});
