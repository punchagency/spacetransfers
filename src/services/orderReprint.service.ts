import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";
import { nextOrderDisplayId } from "./orderNumber.service.js";
import { autoAssignOrder } from "./orderAssignment.service.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { getAssignmentSettings, syncPartnerCapacitySafe } from "./partnerCapacity.service.js";
import { computeAssignmentDeadlineFor } from "../utils/assignmentDeadline.js";
import { groupDesignPicks, packDesigns } from "./sheetDesigns.service.js";
import { renderOrderSheetPreviews } from "./orderPreview.service.js";

/**
 * A free replacement for an order that went wrong.
 *
 * It is a new order of the same sheets to the same address at no charge, so it
 * goes through production, shipping and partner pay like any other. Nothing is
 * taken from the customer; the business carries the print and the postage,
 * which is what its profit then shows.
 *
 * The admin chooses which sheets, and how many of each, go into it: the whole
 * order, or only the part that went wrong. It goes to the partner who printed
 * the original, since putting it right is their job and they have the files.
 */

/** A sheet of the original and how many of it to print again. */
export interface ReprintSelection {
  index: number;
  quantity: number;
}

const fail = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/**
 * The sheets the reprint is made of. No selection means the whole order; a
 * selection names sheets by their place in the original, each at most as many
 * times as it was ordered.
 */
export const selectReprintItems = (original: any, selection?: unknown) => {
  const items: any[] = Array.isArray(original?.items) ? original.items : [];
  const copy = (item: any, quantity: number) => {
    const { _id, ...rest } = item;
    const unit = Number(rest.unitPrice);
    return { ...rest, quantity, ...(Number.isFinite(unit) && rest.subtotal !== undefined ? { subtotal: Math.round(unit * quantity * 100) / 100 } : {}) };
  };
  if (selection === undefined || selection === null) return items.map((item) => copy(item, Number(item.quantity) || 1));
  if (!Array.isArray(selection) || selection.length === 0) throw fail("Choose at least one sheet to reprint.");
  const seen = new Set<number>();
  return selection.map((entry: any) => {
    const index = Number(entry?.index);
    const quantity = Number(entry?.quantity);
    const item = Number.isInteger(index) ? items[index] : undefined;
    if (!item || seen.has(index)) throw fail("One of the chosen sheets isn't on this order.");
    seen.add(index);
    const most = Math.max(1, Number(item.quantity) || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > most) {
      throw fail(`Reprint between 1 and ${most} of “${item.name || `sheet ${index + 1}`}”.`);
    }
    return copy(item, quantity);
  });
};

/** What the replacement is made of. Kept apart from saving it so it can be checked. */
/**
 * Sheets holding only the chosen designs, one per original sheet that had any,
 * each packed short so the film and the partner's pay match the work.
 */
export const selectReprintDesigns = (original: any, picks: unknown) => {
  const items: any[] = Array.isArray(original?.items) ? original.items : [];
  return [...groupDesignPicks(items, picks).entries()]
    .sort(([a], [b]) => a - b)
    .map(([sheet, chosen]) => {
      const { _id, previewImage, designId, ...rest } = items[sheet];
      const packed = packDesigns(items[sheet], chosen);
      const copies = chosen.reduce((sum, p) => sum + p.copies, 0);
      return {
        ...rest,
        name: `${rest.name || `Sheet ${sheet + 1}`}: ${chosen.length === 1 ? "1 design" : `${chosen.length} designs`}, ${copies} ${copies === 1 ? "copy" : "copies"}`,
        quantity: 1,
        unitPrice: 0,
        ...(rest.subtotal !== undefined ? { subtotal: 0 } : {}),
        artboardItems: packed.artboardItems,
        heightIn: packed.sheetHeightIn,
        sheetHeightIn: packed.sheetHeightIn,
      };
    });
};

export const buildReprintOrder = (
  original: any,
  actor: { id: string; name: string },
  note: string,
  now = new Date(),
  selection?: unknown,
  options: {
    /** Designs to reprint, as `{ sheet, design, copies }`; replaces a choice of sheets. */
    designs?: unknown;
    /** Whether the partner is paid for printing it. */
    payPartner?: boolean;
  } = {},
) => {
  const byDesign = options.designs !== undefined && options.designs !== null;
  const items = byDesign ? selectReprintDesigns(original, options.designs) : selectReprintItems(original, selection);
  const all: any[] = original.items || [];
  const chosen = new Map(Array.isArray(selection) ? selection.map((s: any) => [Number(s.index), Number(s.quantity)]) : []);
  const whole = !byDesign && (!Array.isArray(selection) || all.every((it, i) => chosen.get(i) === Math.max(1, Number(it.quantity) || 1)));
  const number = String(original?.displayId || original?._id || "");
  const quote = original?.shippingQuote ? { ...original.shippingQuote, chargedCost: 0 } : undefined;
  return {
    user: original.user,
    items,
    customer: original.customer,
    shippingAddress: original.shippingAddress,
    shippingMethod: original.shippingMethod,
    priority: original.priority,
    payment: { method: "card" as const },
    pricing: { subtotal: 0, rushSurcharge: 0, shippingCost: 0, tax: 0, total: 0, currency: String(original?.pricing?.currency || "USD") },
    shippingQuote: quote,
    reprintOf: {
      orderId: String(original._id),
      displayId: number,
      ...(typeof options.payPartner === "boolean" ? { partnerPaid: options.payPartner } : {}),
    },
    status: "PENDING" as const,
    statusTimeline: [
      {
        status: "PENDING",
        time: now,
        message: `Free reprint of ${whole ? number : `part of ${number}`}${note ? `: ${note}` : ""}`,
        actorRole: "ADMIN",
        actorId: actor.id,
        actorName: actor.name,
      },
    ],
  };
};

export const reprintError = (original: any): string | null => {
  if (!Array.isArray(original?.items) || original.items.length === 0) return "This order has no sheets to reprint.";
  return null;
};

/** Partner states that can still take work. */
const CAN_TAKE_WORK = ["Active", "Under Review"];

/** A partner as a reprint sees them: who, and whether they can take it. */
export const reprintPartnerOf = (partner: any) =>
  partner
    ? {
        id: String(partner._id),
        name: String(partner.companyName || partner.name || "Partner"),
        available: CAN_TAKE_WORK.includes(String(partner.status)),
      }
    : null;

/** The partner who printed the original, and whether they can take the reprint. */
export const originalPartnerOf = async (original: any) => {
  if (!original?.assignedPrinter) return null;
  return reprintPartnerOf(await User.findOne({ _id: original.assignedPrinter, role: "PRINTER" }).select("name companyName status").lean());
};

/**
 * Gives the reprint to the original's partner, before it is first saved, so no
 * other assignment can reach it in between. It skips matching, the manual
 * assignment setting and their job limit: the work is theirs to put right.
 */
const assignToOriginalPartner = async (order: any, partner: { id: string; name: string }, originalNumber: string) => {
  const assignedAt = new Date();
  order.assignedPrinter = new mongoose.Types.ObjectId(partner.id);
  order.assignedAt = assignedAt;
  order.assignmentDeadline = computeAssignmentDeadlineFor(assignedAt, order.priority, (await getAssignmentSettings()).sla.acceptHours);
  order.status = "PROCESSING";
  const reason = `Reprint sent to ${partner.name}, who printed ${originalNumber}`;
  order.statusTimeline.push({ status: "PROCESSING", time: assignedAt, message: reason, actorRole: "SYSTEM", actorId: "REPRINT", actorName: partner.name });
  order.assignmentHistory = [
    {
      time: assignedAt,
      mode: "MANUAL",
      selectedPrinterId: partner.id,
      selectedPrinterName: partner.name,
      customerState: order.shippingAddress?.state || null,
      candidatesConsidered: 0,
      candidatesSameRegion: 0,
      reason,
      tookMs: 0,
    },
  ];
};

/** Tells the partner, once the reprint is saved. */
const announceToPartner = (order: any, partner: { id: string }, originalNumber: string) => {
  syncPartnerCapacitySafe(partner.id);
  notifyPrinter({
    printerId: partner.id,
    category: "jobs",
    priority: "high",
    title: "Reprint assigned to you",
    message:
      `Order #${String(order.displayId || order.id)} is a free reprint of ${originalNumber}, which you printed. Please put it right.` +
      (order.reprintOf?.partnerPaid === false ? " This reprint isn't paid." : ""),
    meta: { orderId: String(order._id), reprintOf: originalNumber },
    settingsKey: "newJobs",
  }).catch(() => {});
};

export interface ReprintResult {
  orderId: string;
  displayId: string;
  /** The partner it went to, when that was the original's partner. */
  partnerName: string | null;
  /** Why it could not go to the original's partner, when it didn't. */
  fallbackReason: string | null;
}

export const createReprintOrder = async (
  original: any,
  actor: { id: string; name: string },
  note: string,
  selection?: unknown,
  options: { designs?: unknown; payPartner?: boolean } = {},
): Promise<ReprintResult> => {
  const refusal = reprintError(original);
  if (refusal) throw Object.assign(new Error(refusal), { statusCode: 400 });

  const originalNumber = String(original?.displayId || original?._id || "");
  const partner = await originalPartnerOf(original);
  const order = new Order({ ...buildReprintOrder(original, actor, note, new Date(), selection, options), displayId: await nextOrderDisplayId() });
  if (partner?.available) await assignToOriginalPartner(order, partner, originalNumber);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await order.save();
      break;
    } catch (e: any) {
      const isDup = e?.code === 11000 && (e?.keyPattern?.displayId || e?.keyValue?.displayId);
      if (!isDup || attempt === 2) throw e;
      order.displayId = await nextOrderDisplayId();
    }
  }

  const displayId = String((order as any).displayId || order.id);
  // A sheet made of chosen designs is new, so it needs its own picture.
  void renderOrderSheetPreviews(order.id, (order as any).toObject().items, { onlyMissing: true }).catch(() => {});
  if (partner?.available) {
    announceToPartner(order, partner, originalNumber);
    return { orderId: String(order.id), displayId, partnerName: partner.name, fallbackReason: null };
  }

  const fallbackReason = !partner
    ? `${originalNumber} has no partner on record`
    : `${partner.name} can't take work right now (their account isn't active)`;
  notifyAllAdmins({
    category: "orders",
    priority: "high",
    title: "Reprint couldn't go to the original partner",
    message: `Reprint ${displayId} of ${originalNumber}: ${fallbackReason}, so it was offered to other partners instead.`,
    meta: { orderId: String(order.id), displayId, type: "reprint_reassigned" },
  }).catch(() => {});
  void autoAssignOrder(order.id).catch((err: any) => {
    console.warn(`[ORDER_ASSIGN] reprint orderId=${order.id} failed (non-fatal): ${err?.message}`);
  });
  return { orderId: String(order.id), displayId, partnerName: null, fallbackReason };
};
