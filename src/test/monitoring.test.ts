import { describe, expect, it } from "vitest";
import { scrubUrl } from "../lib/monitoring";

describe("error reports", () => {
  it("never carry a token from the address", () => {
    expect(scrubUrl("https://x.example/?resetToken=abc123&email=a%40b.c")).toBe("https://x.example/?resetToken=[removed]&email=a%40b.c");
    expect(scrubUrl("https://x.example/set-password?inviteToken=zz")).toBe("https://x.example/set-password?inviteToken=[removed]");
    expect(scrubUrl("https://x.example/orders/1")).toBe("https://x.example/orders/1");
  });
});
