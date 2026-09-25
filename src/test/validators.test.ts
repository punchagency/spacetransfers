import { describe, expect, it } from "vitest";
import { isValidPhone } from "../utils/validators";

/**
 * This mirrors the server's rule by hand (see the note in validators.ts). These
 * cases are the contract: if the server's rule changes, one of them should fail.
 */
describe("isValidPhone", () => {
  it("accepts the shapes people actually type", () => {
    for (const phone of ["+1 (555) 123-4567", "555-123-4567", "+44 20 7946 0958", "5551234567"]) {
      expect(isValidPhone(phone), phone).toBe(true);
    }
  });

  it("refuses empty, too short, too long, and letters", () => {
    for (const phone of ["", "   ", "12345", "1".repeat(16), "555-CALL-NOW", "+1 555 123 4567 ext 9"]) {
      expect(isValidPhone(phone), phone).toBe(false);
    }
  });

  it("counts digits, not characters, so formatting never decides validity", () => {
    expect(isValidPhone("+1 (555) 123-4567")).toBe(isValidPhone("15551234567"));
  });
});
