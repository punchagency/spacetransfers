import { isValidPhone } from "./validators";

/**
 * The checkout form's rules, one message per field.
 *
 * Kept apart from the form so the modal (on Continue) and the fields (on blur)
 * judge a value the same way. Before this, the modal checked on Continue only,
 * and Continue stayed disabled until every field had *something* in it — so a
 * shopper with one bad field faced a grey button and no hint which field.
 *
 * Addresses are US-only on purpose: every order ships on a domestic label, and
 * the label step refuses a non-US address (`shipstation.service.ts`). Letting
 * one through here meant a paid order that could never ship.
 */

export type CheckoutFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type CheckoutField = keyof CheckoutFields;

/** Form order, so the first problem found is the first one on screen. */
export const CHECKOUT_FIELD_ORDER: CheckoutField[] = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "street",
  "city",
  "state",
  "postalCode",
  "country",
];

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

/** The ways people write the United States; the server maps these to "US". */
export const isUnitedStates = (country: string): boolean =>
  ["us", "usa", "unitedstates", "unitedstatesofamerica"].includes(
    country.toLowerCase().replace(/[.\s]/g, ""),
  );

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP = /^\d{5}(-\d{4})?$/;

/** The problem with one field's value, or null when it is fine. */
export const checkoutFieldError = (field: CheckoutField, raw: string): string | null => {
  const value = String(raw ?? "").trim();
  switch (field) {
    case "firstName":
      return value ? null : "Enter your first name";
    case "lastName":
      return value ? null : "Enter your last name";
    case "email":
      if (!value) return "Enter your email address";
      return EMAIL.test(value) ? null : "Enter a valid email address, like name@example.com";
    case "phone":
      if (!value) return "Enter a phone number";
      return isValidPhone(value) ? null : "Enter a valid phone number, with at least 7 digits";
    case "street":
      return value ? null : "Enter your street address";
    case "city":
      return value ? null : "Enter your city";
    case "state":
      if (!value) return "Enter your state";
      return US_STATE_CODES.has(value.toUpperCase()) ? null : "Enter a 2-letter US state code, like CA";
    case "postalCode":
      if (!value) return "Enter your ZIP code";
      return ZIP.test(value) ? null : "Enter a 5-digit ZIP code, like 97201";
    case "country":
      if (!value) return "Enter your country";
      return isUnitedStates(value) ? null : "We only ship within the United States for now";
  }
};

/** Every field's problem, in form order. Empty when the form is ready. */
export const checkoutFormErrors = (
  data: CheckoutFields,
): Partial<Record<CheckoutField, string>> => {
  const errors: Partial<Record<CheckoutField, string>> = {};
  for (const field of CHECKOUT_FIELD_ORDER) {
    const message = checkoutFieldError(field, data[field]);
    if (message) errors[field] = message;
  }
  return errors;
};
