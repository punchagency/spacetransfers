import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertOrderRequest, buildOrderItem } from "../services/orderCreation.service.js";
import { DEFAULT_GLOBAL_PRICING, normalizeGlobalPricing } from "../services/pricing.service.js";

const pricing = normalizeGlobalPricing({ ...DEFAULT_GLOBAL_PRICING, baseRatePerSqFt: 3.5, sheetWidthIn: 23.5, minSheetLengthIn: 12 });

const request = (over: any = {}) => ({
  items: [{ type: "gangsheet", name: "Sheet" }],
  customer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  shippingAddress: { street: "100 SW Main St", city: "Portland", state: "OR", postalCode: "97204", country: "US" },
  shippingMethod: "standard",
  payment: { method: "card", paymentIntentId: "pi_1" },
  pricing: { subtotal: 6.86, shippingCost: 8.99, tax: 0.55, total: 16.4, currency: "USD" },
  ...over,
});
const refuses = (over: any, status = 400) =>
  assert.throws(() => assertOrderRequest(request(over)), (e: any) => e.statusCode === status, JSON.stringify(over));

const piece = (over: any = {}) => ({ id: 1, assetId: "a1", widthIn: 4, heightIn: 3, posX: 0.15, posY: 0.15, copies: 1, ...over });
const line = (over: any = {}) => ({
  type: "gangsheet",
  name: "Logo sheet",
  designId: "d1",
  widthIn: 23.5,
  heightIn: 12,
  sheetWidthIn: 23.5,
  quantity: 2,
  unitPrice: 0.01,
  artboardItems: [piece()],
  ...over,
});

describe("order request checks", () => {
  it("accepts a complete request", () => {
    assert.doesNotThrow(() => assertOrderRequest(request()));
  });

  it("refuses a request missing its items, customer, address, shipping method or payment", () => {
    refuses({ items: [] });
    refuses({ customer: { firstName: "Ada" } });
    refuses({ shippingAddress: { street: "x" } });
    refuses({ shippingMethod: "" });
    refuses({ payment: null });
    refuses({ pricing: { subtotal: 1 } });
  });

  it("takes card payments only, and needs the payment's id", () => {
    assert.throws(() => assertOrderRequest(request({ payment: { method: "bank_transfer", paymentIntentId: "x" } })));
    assert.throws(() => assertOrderRequest(request({ payment: { method: "card" } })));
  });
});

describe("building an order item", () => {
  it("prices the sheet itself and ignores the price the request named", () => {
    const item = buildOrderItem(line(), pricing);
    // 23.5in roll x 12in minimum = 1.96 sq ft at $3.50.
    assert.equal(item.unitPrice, 6.86);
    assert.equal(item.quantity, 2);
    assert.equal(item.subtotal, 13.72);
    assert.equal(item.rollWidthIn, 23.5);
  });

  it("keeps placements with their pixel sizes, and drops broken ones", () => {
    const item = buildOrderItem(
      line({ artboardItems: [piece({ croppedWidthPx: 1200.4, nativeWidthPx: 1500 }), { id: 2 }, null] }),
      pricing,
    );
    assert.equal(item.artboardItems?.length, 1);
    assert.equal(item.artboardItems?.[0].croppedWidthPx, 1200);
    assert.equal(item.artboardItems?.[0].nativeWidthPx, 1500);
  });

  it("resolves artwork references through the asset table", () => {
    const item = buildOrderItem(
      line({ assetTable: { urls: ["https://cdn/a.png", "https://cdn/a-crop.png"] }, artboardItems: [piece({ assetId: undefined, assetRef: 0, croppedRef: 1 })] }),
      pricing,
    );
    assert.equal(item.artboardItems?.[0].assetId, "https://cdn/a.png");
    assert.equal(item.artboardItems?.[0].croppedUrl, "https://cdn/a-crop.png");
  });

  it("bills the length that will actually print when the request understates it", () => {
    const item = buildOrderItem(line({ artboardItems: [piece({ posY: 30, heightIn: 6 })] }), pricing);
    assert.ok(Number(item.heightIn) > 30, `billed ${item.heightIn}`);
    assert.ok(item.unitPrice > 6.86);
  });

  it("refuses a sheet built for a different roll width", () => {
    assert.throws(() => buildOrderItem(line({ sheetWidthIn: 22 }), pricing), (e: any) => e.statusCode === 409 && /sheet width changed/.test(e.message));
  });

  it("refuses artwork that runs past the edge of the roll", () => {
    assert.throws(
      () => buildOrderItem(line({ artboardItems: [piece({ posX: 22, widthIn: 6 })] }), pricing),
      (e: any) => e.statusCode === 409 && /extends past/.test(e.message),
    );
  });

  it("needs a type and a name", () => {
    assert.throws(() => buildOrderItem({ type: "gangsheet" }, pricing), (e: any) => e.statusCode === 400);
  });
});
