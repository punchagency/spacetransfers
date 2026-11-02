import { describe, expect, it } from "vitest";
import {
  CHECKOUT_FIELD_ORDER,
  checkoutFieldError,
  checkoutFormErrors,
  isUnitedStates,
  type CheckoutFields,
} from "../lib/utils/checkoutValidation";

const valid: CheckoutFields = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: "(503) 555-0123",
  street: "100 SW Main St",
  city: "Portland",
  state: "OR",
  postalCode: "97204",
  country: "US",
};

describe("checkout validation", () => {
  it("accepts a complete US address", () => {
    expect(checkoutFormErrors(valid)).toEqual({});
  });

  it("names every empty field, in form order", () => {
    const empty = Object.fromEntries(CHECKOUT_FIELD_ORDER.map((k) => [k, "  "])) as CheckoutFields;
    const errors = checkoutFormErrors(empty);
    expect(Object.keys(errors)).toEqual(CHECKOUT_FIELD_ORDER);
    expect(errors.postalCode).toBe("Enter your ZIP code");
  });

  it("rejects a malformed email and phone", () => {
    expect(checkoutFieldError("email", "ada@example")).toMatch(/valid email/);
    expect(checkoutFieldError("phone", "12345")).toMatch(/at least 7 digits/);
    expect(checkoutFieldError("phone", "+1 503 555 0123")).toBeNull();
  });

  it("only takes real US state codes", () => {
    expect(checkoutFieldError("state", "or")).toBeNull();
    expect(checkoutFieldError("state", "DC")).toBeNull();
    expect(checkoutFieldError("state", "XX")).toMatch(/2-letter US state code/);
  });

  it("takes 5-digit and ZIP+4 codes only", () => {
    expect(checkoutFieldError("postalCode", "97204")).toBeNull();
    expect(checkoutFieldError("postalCode", "97204-1234")).toBeNull();
    expect(checkoutFieldError("postalCode", "9720")).toMatch(/5-digit ZIP/);
    expect(checkoutFieldError("postalCode", "SW1A 1AA")).toMatch(/5-digit ZIP/);
  });

  it("accepts the ways people write the US and refuses other countries", () => {
    for (const us of ["US", "us", "USA", "U.S.A.", "United States", "united states of america"]) {
      expect(isUnitedStates(us), us).toBe(true);
    }
    expect(checkoutFieldError("country", "Canada")).toBe("We only ship within the United States for now");
    expect(checkoutFieldError("country", "UK")).not.toBeNull();
  });
});
