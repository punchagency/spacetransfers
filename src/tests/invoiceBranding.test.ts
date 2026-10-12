import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderInvoicePdf } from "../services/invoicePdf.service.js";

const invoice = (items: number) =>
  renderInvoicePdf({
    orderId: "DTF-0295",
    date: "October 7, 2026",
    shippingAddress: { name: "Ada Lovelace", street: "100 SW Main St", city: "Portland", state: "OR", postalCode: "97204", country: "US" },
    items: Array.from({ length: items }, (_, i) => ({ name: `Gang sheet ${i + 1}`, description: "23.5in x 12in", quantity: 1, unitPrice: 6.86, subtotal: 6.86 })),
    pricing: { lineItems: [{ label: "Subtotal", amount: 6.86 * items }], total: 6.86 * items, currency: "USD" },
  });

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;

describe("invoice branding", () => {
  it("carries the brand mark", async () => {
    assert.match((await invoice(1)).toString("latin1"), /\/Subtype \/Image/);
  });

  it("keeps an ordinary invoice, footer included, on one page", async () => {
    assert.equal(pages(await invoice(3)), 1);
  });

  it("still runs onto more pages for a long order", async () => {
    assert.ok(pages(await invoice(60)) > 1);
  });
});
