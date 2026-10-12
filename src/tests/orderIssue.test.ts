import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanIssueText,
  issueForAdmin,
  issueForCustomer,
  issueForPartner,
  issueReportError,
  parseIssueType,
  cleanIssueAttachments,
  partnerCanSeeIssue,
  partnerIssueFlags,
  partnerOwesReply,
  resolutionMessage,
} from "../services/orderIssue.service.js";
import { buildReprintOrder, reprintError } from "../services/orderReprint.service.js";
import { computeOrderFinancials } from "../services/orderFinancials.service.js";
import { orderInvoiceNote } from "../utils/orderPresentation.js";

const at = new Date("2026-10-12T10:00:00Z");
const issue = (over: any = {}) => ({
  _id: "i1",
  order: "o1",
  displayId: "DTF-0300",
  user: "u1",
  partner: "p1",
  type: "DAMAGED",
  description: "The box was crushed",
  status: "OPEN",
  needsAdmin: true,
  customerUnread: false,
  messages: [
    { _id: "m1", channel: "CUSTOMER", author: "ADMIN", authorName: "Brian", body: "Sorry about that. Can you send a photo?", at },
    { _id: "m2", channel: "CUSTOMER", author: "CUSTOMER", authorName: "Ada Obi", body: "Sent.", at },
    { _id: "m3", channel: "PARTNER", author: "ADMIN", authorName: "Brian", body: "How was this packed?", at },
    { _id: "m4", channel: "PARTNER", author: "PARTNER", authorName: "Print Co", body: "Tube, as usual.", at },
  ],
  ...over,
});

describe("reporting a problem with an order", () => {
  it("accepts the four kinds of problem and nothing else", () => {
    for (const t of ["NOT_RECEIVED", "DAMAGED", "NEEDS_REPRINT", "OTHER", "damaged"]) assert.ok(parseIssueType(t), t);
    for (const t of ["", "REFUND", null, 3]) assert.equal(parseIssueType(t), null);
  });

  it("needs words only for 'something else', and refuses a cancelled order", () => {
    assert.equal(issueReportError({ status: "SHIPPED" }, "DAMAGED", ""), null);
    assert.equal(issueReportError({ status: "PROCESSING" }, "NOT_RECEIVED", ""), null);
    assert.match(issueReportError({ status: "SHIPPED" }, "OTHER", "")!, /what went wrong/);
    assert.equal(issueReportError({ status: "SHIPPED" }, "OTHER", "Wrong colours"), null);
    assert.match(issueReportError({ status: "CANCELLED" }, "DAMAGED", "")!, /cancelled/);
  });

  it("trims messages and limits their length", () => {
    assert.deepEqual(cleanIssueText("  hello  ", { required: true }), { text: "hello", error: null });
    assert.match(cleanIssueText("   ", { required: true }).error!, /Write a message/);
    assert.equal(cleanIssueText("", { required: false }).error, null);
    assert.match(cleanIssueText("x".repeat(2001), { required: true }).error!, /under 2000/);
  });
});

describe("who sees what on a report", () => {
  it("shows the admin both conversations", () => {
    const view = issueForAdmin(issue());
    assert.equal(view.messages.length, 4);
    assert.equal(view.typeLabel, "Order arrived damaged");
    assert.equal(view.partnerId, "p1");
  });

  it("shows the customer only their own conversation, with staff unnamed", () => {
    const view = issueForCustomer(issue());
    assert.deepEqual(view.messages.map((m: { id: string }) => m.id), ["m1", "m2"]);
    assert.equal(view.messages[0].authorName, "Space Transfers");
    assert.equal(JSON.stringify(view).includes("Tube, as usual"), false);
    assert.equal(JSON.stringify(view).includes("Brian"), false);
  });

  it("shows the partner only their own conversation, without the customer's words or the outcome", () => {
    const settled = issue({ status: "RESOLVED", resolution: { outcome: "REFUND", note: "Refunded for the damage", refundAmount: 10, at, byName: "Brian" } });
    const view = issueForPartner(settled);
    assert.deepEqual(view.messages.map((m: { id: string }) => m.id), ["m3", "m4"]);
    const text = JSON.stringify(view);
    for (const hidden of ["The box was crushed", "Sent.", "Refunded for the damage", "Brian"]) assert.equal(text.includes(hidden), false, hidden);
  });

  it("keeps a report from a partner until the admin writes to them, and from any other partner", () => {
    assert.equal(partnerCanSeeIssue(issue(), "p1"), true);
    assert.equal(partnerCanSeeIssue(issue(), "p2"), false);
    assert.equal(partnerCanSeeIssue(issue({ messages: issue().messages.slice(0, 2) }), "p1"), false);
    assert.equal(partnerCanSeeIssue(issue({ partner: null }), "p1"), false);
  });

  it("tells the customer how it ended", () => {
    const view = issueForCustomer(
      issue({ status: "RESOLVED", resolution: { outcome: "REPRINT", note: "On its way", reprintOrderId: "o2", reprintDisplayId: "DTF-0301", at, byName: "Brian" } }),
    );
    assert.equal(view.resolution!.outcomeLabel, "Free reprint sent");
    assert.equal(view.resolution!.reprintDisplayId, "DTF-0301");
    assert.equal("byName" in view.resolution!, false);
  });
});

describe("photos on a report", () => {
  const ours = (url: string) => url.startsWith("https://files.example.com/");
  const photo = (n: number) => ({ url: `https://files.example.com/issues/u1/${n}.jpg`, name: `IMG_${n}.jpg` });

  it("takes up to four of our own stored photos", () => {
    assert.deepEqual(cleanIssueAttachments(undefined, ours), { attachments: [], error: null });
    assert.deepEqual(cleanIssueAttachments([photo(1), photo(2)], ours).attachments, [photo(1), photo(2)]);
    assert.match(cleanIssueAttachments([1, 2, 3, 4, 5].map(photo), ours).error!, /up to 4/);
  });

  it("refuses a link to anywhere else, or to a file that is not a report photo", () => {
    assert.match(cleanIssueAttachments([{ url: "https://evil.example.org/issues/x.jpg" }], ours).error!, /couldn't be attached/);
    assert.match(cleanIssueAttachments([{ url: "https://files.example.com/artwork/x.png" }], ours).error!, /couldn't be attached/);
    assert.match(cleanIssueAttachments("nope", ours).error!, /couldn't be read/);
  });

  it("shows them to the admin and the customer, never to the partner", () => {
    const withPhotos = issue({
      attachments: [photo(1)],
      messages: [...issue().messages, { _id: "m5", channel: "CUSTOMER", author: "CUSTOMER", authorName: "Ada Obi", body: "", attachments: [photo(2)], at }],
    });
    assert.deepEqual(issueForAdmin(withPhotos).attachments, [photo(1)]);
    assert.deepEqual(issueForAdmin(withPhotos).messages[4].attachments, [photo(2)]);
    assert.deepEqual(issueForCustomer(withPhotos).attachments, [photo(1)]);
    assert.equal(JSON.stringify(issueForPartner(withPhotos)).includes("files.example.com"), false);
  });
});

describe("a partner's job list", () => {
  it("flags an order with an open question, and whether it waits on them", () => {
    const asked = issue({ order: "o1", messages: issue().messages.slice(0, 3) });
    const answered = issue({ order: "o2" });
    const notAsked = issue({ order: "o3", messages: issue().messages.slice(0, 2) });
    const settled = issue({ order: "o4", status: "RESOLVED", messages: issue().messages.slice(0, 3) });
    const flags = partnerIssueFlags([asked, answered, notAsked, settled], "p1");
    assert.deepEqual(flags.get("o1"), { open: true, awaitingReply: true });
    assert.deepEqual(flags.get("o2"), { open: true, awaitingReply: false });
    assert.equal(flags.has("o3"), false);
    assert.equal(flags.has("o4"), false);
    assert.equal(partnerIssueFlags([asked], "p2").size, 0);
    assert.equal(partnerOwesReply(asked), true);
    assert.equal(partnerOwesReply(settled), false);
  });
});

describe("what the customer is told when a report is settled", () => {
  it("leads with what was done, then the admin's own words", () => {
    assert.equal(resolutionMessage("REFUND", "Sorry for the damage.", { refundAmount: 25.5 }), "We've refunded $25.50 to your card.\n\nSorry for the damage.");
    assert.equal(resolutionMessage("REPRINT", "", { reprintDisplayId: "DTF-0301" }), "We're reprinting your order free of charge as DTF-0301.");
    assert.equal(resolutionMessage("NONE", "The carrier shows it was delivered."), "The carrier shows it was delivered.");
  });
});

describe("a free reprint", () => {
  const original = {
    _id: "o1",
    displayId: "DTF-0300",
    user: "u1",
    status: "COMPLETED",
    priority: "NORMAL",
    items: [{ _id: "x1", type: "gangsheet", widthIn: 23.5, heightIn: 19.21, quantity: 1, designId: "d1" }],
    customer: { firstName: "Ada", lastName: "Obi", email: "ada@example.com" },
    shippingAddress: { street: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "US" },
    shippingMethod: "standard",
    payment: { method: "card", paymentIntentId: "pi_1", processingFee: 1.12 },
    pricing: { subtotal: 17.82, shippingCost: 8.99, tax: 1.43, total: 28.24, currency: "USD" },
    shippingQuote: { carrierCost: 6.5, chargedCost: 8.99, source: "live" },
    trackingNumber: "1Z999",
  };
  const ACTOR = { id: "a1", name: "Admin" };

  it("is the same sheets to the same address at no charge", () => {
    const reprint = buildReprintOrder(original, ACTOR, "Arrived damaged", at);
    assert.deepEqual(reprint.items, [{ type: "gangsheet", widthIn: 23.5, heightIn: 19.21, quantity: 1, designId: "d1" }]);
    assert.deepEqual(reprint.shippingAddress, original.shippingAddress);
    assert.equal(reprint.pricing.total, 0);
    assert.deepEqual(reprint.payment, { method: "card" });
    assert.deepEqual(reprint.reprintOf, { orderId: "o1", displayId: "DTF-0300" });
    assert.equal(reprint.status, "PENDING");
    assert.equal(reprint.statusTimeline[0].message, "Free reprint of DTF-0300: Arrived damaged");
    assert.equal("trackingNumber" in reprint, false);
  });

  it("costs the business the print and the postage", () => {
    const RATE = { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } };
    const f = computeOrderFinancials(buildReprintOrder(original, ACTOR, "", at), RATE);
    assert.equal(f.customerPaid, 0);
    assert.equal(f.shippingCost, 6.5);
    assert.ok(f.partnerCost! > 0);
    assert.equal(f.profit, Math.round(-(f.partnerCost! + 6.5) * 100) / 100);
  });

  it("says so on its invoice, and needs sheets to reprint", () => {
    assert.equal(orderInvoiceNote({ ...buildReprintOrder(original, ACTOR, "", at) }), "Free reprint of order DTF-0300.");
    assert.equal(orderInvoiceNote(original), null);
    assert.match(reprintError({ items: [] })!, /no sheets/);
    assert.equal(reprintError(original), null);
  });
});
