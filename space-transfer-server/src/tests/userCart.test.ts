/**
 * The saved cart must survive being written.
 * Run with: npm test — no network, no database.
 *
 * `cart` was declared on the user interface but not on the schema, so strict
 * mode dropped every write: `PUT /customer/cart` answered "Cart updated" and
 * stored nothing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { User } from "../models/user.model.js";

describe("user cart", () => {
  it("is part of the schema, so writes to it are kept", () => {
    assert.ok(User.schema.path("cart"), "cart is not declared on the user schema");
  });

  it("keeps cart lines as they were sent", () => {
    const line = { id: 1, type: "gangsheet", designSignature: "abc", price: 8.58, items: [{ assetId: "x", posX: 1 }] };
    const user = new User({ email: "a@example.test", name: "A", cart: [line] });
    assert.deepEqual(JSON.parse(JSON.stringify(user.toObject().cart)), [line]);
  });

  it("is not stored on users who never had one", () => {
    const user = new User({ email: "b@example.test", name: "B" });
    assert.equal(user.toObject().cart, undefined);
  });
});
