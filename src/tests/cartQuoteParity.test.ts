import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Checkout shows the cart quote; the card is charged from the Stripe intent.
 * Both must be priced by the same function, or the customer pays a figure they
 * were never shown. The quote used to price on its own — stored design area,
 * `copies` only — and silently disagreed with the charge.
 */
const body = (src: string, name: string) => {
  const start = src.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport const ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
};

describe("cart quote and charge are priced the same way", () => {
  it("both go through priceItems", async () => {
    const customer = await readFile("src/controllers/customer.controller.ts", "utf8");
    const payments = await readFile("src/controllers/payments.controller.ts", "utf8");

    const quote = body(customer, "getCartQuote");
    const charge = body(payments, "createStripePaymentIntent");

    assert.match(charge, /priceItems\(/, "the charge prices through priceItems");
    assert.match(quote, /priceItems\(/, "the quote must price through priceItems too");
    for (const own of ["sheetUnitPrice(", "quoteShipping(", "computeOrderTotals("]) {
      assert.ok(!quote.includes(own), `the quote must not price on its own (${own})`);
    }
  });
});
