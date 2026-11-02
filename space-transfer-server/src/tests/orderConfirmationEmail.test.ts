import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrderConfirmationEmail } from "../services/orderEmails.service.js";

const order = {
  displayId: "DTF-0300",
  shippingMethod: "express",
  customer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  shippingAddress: { street: "100 SW Main St", city: "Portland", state: "OR", postalCode: "97204" },
  items: [{ name: "Logo <b>sheet</b>", widthIn: 23.5, heightIn: 12, quantity: 2, subtotal: 13.72 }],
  pricing: { subtotal: 13.72, rushSurcharge: 1.37, shippingCost: 24.99, tax: 1.21, total: 41.29, currency: "USD" },
};

describe("order confirmation email", () => {
  const { subject, html } = buildOrderConfirmationEmail(order);

  it("names the order in the subject", () => {
    assert.equal(subject, "Your Space Transfers order DTF-0300");
  });

  it("lists the sheets, every charge and the total", () => {
    for (const text of ['23.5" × 12.0"', "Rush production", "Express shipping", "$24.99", "Tax", "$41.29", "Portland, OR 97204"]) {
      assert.ok(html.includes(text.replace(/"/g, "&quot;")) || html.includes(text), text);
    }
  });

  it("escapes customer-supplied text", () => {
    assert.ok(html.includes("Logo &lt;b&gt;sheet&lt;/b&gt;"));
    assert.ok(!html.includes("<b>sheet</b>"));
  });
});
