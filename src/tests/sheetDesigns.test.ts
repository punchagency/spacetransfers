/**
 * Reprinting individual designs: drawing a sheet's designs where they print,
 * and packing a chosen few onto a new, shorter sheet.
 * Run with: npm test — no network, no database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeSheet, groupDesignPicks, packDesigns } from "../services/sheetDesigns.service.js";
import { buildReprintOrder } from "../services/orderReprint.service.js";
import { getOrderPartnerCostBreakdown, isUnpaidReprint } from "../services/partnerEarnings.service.js";
import { cleanAffectedDesigns } from "../services/orderIssue.service.js";

const art = (over: any) => ({ id: 1, assetId: "a".repeat(24), widthIn: 3, heightIn: 2, posX: 0.25, posY: 0.25, rotation: 0, copies: 1, ...over });
const sheet = {
  name: "Shirts",
  type: "gangsheet",
  rollWidthIn: 22,
  widthIn: 22,
  heightIn: 40,
  sheetWidthIn: 22,
  sheetHeightIn: 40,
  quantity: 2,
  itemSpacingIn: 0.25,
  sheetMarginIn: 0.25,
  previewImage: "/uploads/old.webp",
  designId: "d1",
  artboardItems: [
    art({ id: 1, copies: 10 }),
    art({ id: 2, widthIn: 10, heightIn: 8, posY: 6 }),
    art({ id: 3, widthIn: 4, heightIn: 4, posY: 15, rotation: 45 }),
    art({ id: 4, widthIn: 5, heightIn: 2, posY: 30, nestRotation: 90 }),
  ],
};
const imageOf = () => "https://cdn.example/x.png";

/** Every drawn copy's box on a sheet, using the same walk the preview uses. */
const boxes = (item: any) =>
  describeSheet(item, 0, imageOf).designs.flatMap((d) =>
    d.centers.map((c) => ({ d: d.index, l: c.x - d.widthIn / 2, r: c.x + d.widthIn / 2, t: c.y - d.heightIn / 2, b: c.y + d.heightIn / 2 })),
  );

describe("a sheet's designs", () => {
  it("are drawn copy by copy where they print", () => {
    const view = describeSheet(sheet, 0, imageOf);
    assert.equal(view.designs.length, 4);
    assert.equal(view.designs[0].centers.length, 10);
    assert.equal(view.designs[3].widthIn, 2, "a nested piece is turned a quarter");
    assert.ok(view.designs[2].widthIn > 4, "a 45° piece is drawn wider than it is");
    assert.ok(view.heightIn > 30 && view.heightIn < 40);
  });
});

describe("packing chosen designs", () => {
  const picks = [
    { design: 3, copies: 1 },
    { design: 0, copies: 7 },
    { design: 2, copies: 1 },
  ];
  const packed = packDesigns(sheet, picks);
  const item = { ...sheet, artboardItems: packed.artboardItems, sheetHeightIn: packed.sheetHeightIn };

  it("keeps only them, with the copies asked for, size, turn and flip unchanged", () => {
    assert.deepEqual(packed.artboardItems.map((a: any) => a.id), [1, 3, 4], "in the order they sat on the sheet");
    assert.equal(packed.artboardItems[0].copies, 7);
    assert.equal(packed.artboardItems[1].rotation, 45);
    assert.equal(packed.artboardItems[2].nestRotation, 90);
    assert.equal(packed.artboardItems[0].widthIn, 3);
  });

  it("never overlaps them, keeps them on the roll, and is much shorter", () => {
    const all = boxes(item);
    for (const x of all) {
      assert.ok(x.l >= 0.25 - 1e-6 && x.r <= 22 - 0.25 + 1e-6, `inside the margins: ${JSON.stringify(x)}`);
      assert.ok(x.b <= packed.sheetHeightIn + 1e-6);
    }
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const overlap = a.l < b.r - 1e-6 && b.l < a.r - 1e-6 && a.t < b.b - 1e-6 && b.t < a.b - 1e-6;
        assert.equal(overlap, false, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`);
      }
    assert.ok(packed.sheetHeightIn < 15, `packed to ${packed.sheetHeightIn}in`);
  });

  it("refuses designs that aren't there, twice, or more copies than printed", () => {
    for (const bad of [[], [{ sheet: 1, design: 0 }], [{ sheet: 0, design: 9 }], [{ sheet: 0, design: 0, copies: 11 }], [{ sheet: 0, design: 0 }, { sheet: 0, design: 0 }], "x"]) {
      assert.throws(() => groupDesignPicks([sheet], bad), (e: any) => e.statusCode === 400, JSON.stringify(bad));
    }
    assert.deepEqual([...groupDesignPicks([sheet], [{ sheet: 0, design: 0 }]).values()][0], [{ design: 0, copies: 10 }], "all copies unless told");
  });
});

describe("a reprint of chosen designs", () => {
  const original = { _id: "o1", displayId: "DTF-0400", user: "u1", priority: "NORMAL", items: [sheet], customer: {}, shippingAddress: {}, pricing: { currency: "USD" } };
  const actor = { id: "a1", name: "Admin" };

  it("is one new sheet per original sheet, with a fresh picture and the choice of pay", () => {
    const r = buildReprintOrder(original, actor, "", new Date(), undefined, { designs: [{ sheet: 0, design: 1 }], payPartner: false });
    assert.equal(r.items.length, 1);
    const it: any = r.items[0];
    assert.equal(it.quantity, 1);
    assert.equal(it.previewImage, undefined);
    assert.equal(it.designId, undefined);
    assert.equal(it.artboardItems.length, 1);
    assert.equal(it.sheetHeightIn, it.heightIn);
    assert.match(it.name, /1 design, 1 copy/);
    assert.equal(r.reprintOf.partnerPaid, false);
    assert.match(r.statusTimeline[0].message, /part of DTF-0400/);
  });

  it("isn't paid when the admin said so, and older reprints still are", () => {
    const RATE = { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } };
    const unpaid = buildReprintOrder(original, actor, "", new Date(), undefined, { payPartner: false });
    const paid = buildReprintOrder(original, actor, "", new Date(), undefined, { payPartner: true });
    assert.equal(isUnpaidReprint(unpaid), true);
    assert.equal(getOrderPartnerCostBreakdown(unpaid, RATE).subtotal, 0);
    assert.ok(getOrderPartnerCostBreakdown(unpaid, RATE).totalSqFt > 0, "the area still describes the work");
    assert.ok(getOrderPartnerCostBreakdown(paid, RATE).subtotal > 0);
    assert.ok(getOrderPartnerCostBreakdown({ ...paid, reprintOf: { orderId: "o1", displayId: "DTF-0400" } }, RATE).subtotal > 0);
  });
});

describe("designs a customer marks", () => {
  const order = { items: [sheet] };
  it("are optional, must be on the order, and are kept once each", () => {
    assert.deepEqual(cleanAffectedDesigns(order, undefined), { designs: [], error: null });
    assert.deepEqual(cleanAffectedDesigns(order, [{ sheet: 0, design: 1 }, { sheet: 0, design: 1 }]).designs, [{ sheet: 0, design: 1 }]);
    assert.ok(cleanAffectedDesigns(order, [{ sheet: 0, design: 7 }]).error);
    assert.ok(cleanAffectedDesigns(order, "all").error);
  });
});
