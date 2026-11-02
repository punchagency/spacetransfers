import { env } from "../config/env.js";
import { sendEmail, type EmailResult } from "./email.service.js";
import { formatSheetSize, orderChargeLines } from "../utils/orderPresentation.js";

/**
 * The customer's receipt for an order: its number, sheets, every charge and
 * where it ships. Built from the same charge lines as the invoice and the order
 * details, so the three agree.
 */

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const usd = (n: number, currency: string) => {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(n));
  return n < 0 ? `-${amount}` : amount;
};

export const buildOrderConfirmationEmail = (order: any): { subject: string; html: string } => {
  const number = String(order?.displayId || order?._id || "");
  const currency = String(order?.pricing?.currency || "USD");
  const items: any[] = Array.isArray(order?.items) ? order.items : [];
  const address = order?.shippingAddress || {};
  const express = String(order?.shippingMethod || "").toLowerCase() === "express";
  const cell = "padding: 6px 0; border-bottom: 1px solid #e5e7eb;";

  const itemRows = items
    .map((it) => {
      const size = formatSheetSize(it.sheetWidthIn ?? it.widthIn, it.sheetHeightIn ?? it.heightIn);
      return `<tr>
        <td style="${cell}">${esc(it.name || "Gang sheet")}${size ? `<div style="font-size: 12px; color: #6b7280;">${esc(size)}</div>` : ""}</td>
        <td style="${cell} text-align: center;">${esc(it.quantity || 1)}</td>
        <td style="${cell} text-align: right;">${usd(Number(it.subtotal) || 0, currency)}</td>
      </tr>`;
    })
    .join("");

  const chargeRows = orderChargeLines(order)
    .map(
      (line) => `<tr>
        <td style="padding: 3px 0; color: #6b7280;">${esc(line.label)}</td>
        <td style="padding: 3px 0; text-align: right;">${usd(line.amount, currency)}</td>
      </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 560px;">
      <h2 style="margin: 0 0 8px 0;">Thanks for your order, ${esc(order?.customer?.firstName || "there")}!</h2>
      <p style="margin: 0 0 16px 0;">We've received order <strong>${esc(number)}</strong> and it's on its way to print.</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 0 0 12px 0;">
        <tr>
          <th style="text-align: left; padding: 6px 0; border-bottom: 2px solid #111827;">Sheet</th>
          <th style="text-align: center; padding: 6px 0; border-bottom: 2px solid #111827;">Qty</th>
          <th style="text-align: right; padding: 6px 0; border-bottom: 2px solid #111827;">Price</th>
        </tr>
        ${itemRows}
      </table>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 0 0 16px 0;">
        ${chargeRows}
        <tr>
          <td style="padding: 8px 0 0 0; border-top: 1px solid #e5e7eb; font-weight: 700;">Total</td>
          <td style="padding: 8px 0 0 0; border-top: 1px solid #e5e7eb; font-weight: 700; text-align: right;">${usd(Number(order?.pricing?.total) || 0, currency)}</td>
        </tr>
      </table>
      <div style="margin: 0 0 16px 0; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; font-size: 14px;">
        <div style="font-weight: 600; margin: 0 0 4px 0;">Shipping to</div>
        <div>${esc(`${order?.customer?.firstName || ""} ${order?.customer?.lastName || ""}`.trim())}</div>
        <div>${esc(address.street)}</div>
        <div>${esc(address.city)}, ${esc(address.state)} ${esc(address.postalCode)}</div>
        <div style="margin-top: 6px; color: #6b7280;">${express ? "Express shipping (urgent order)" : "Standard shipping"}</div>
      </div>
      <p style="margin: 0 0 16px 0;">
        <a href="${esc(env.appUrl.replace(/\/$/, ""))}" style="display: inline-block; padding: 10px 14px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 10px;">
          View your order
        </a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">
        You can follow this order and download its invoice any time under Account, Order History.
      </p>
    </div>
  `;

  return { subject: `Your Space Transfers order ${number}`, html };
};

/** Sends the receipt to the email given at checkout. Never throws. */
export const sendOrderConfirmationEmail = async (order: any): Promise<EmailResult | null> => {
  const to = String(order?.customer?.email || "").trim();
  if (!to) return null;
  try {
    return await sendEmail({ to, ...buildOrderConfirmationEmail(order) });
  } catch (err: any) {
    console.warn(`[ORDER_EMAIL] order ${order?.displayId || order?._id} confirmation failed: ${err?.message}`);
    return null;
  }
};

/** Tells the customer their order was cancelled and what was refunded. Never throws. */
export const sendOrderCancelledEmail = async (
  order: any,
  refundAmount: number,
  reason: string,
): Promise<EmailResult | null> => {
  const to = String(order?.customer?.email || "").trim();
  if (!to) return null;
  const number = String(order?.displayId || order?._id || "");
  const currency = String(order?.pricing?.currency || "USD");
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 560px;">
      <h2 style="margin: 0 0 8px 0;">Your order ${esc(number)} was cancelled</h2>
      <p style="margin: 0 0 12px 0;">${esc(reason)}</p>
      <p style="margin: 0 0 12px 0;">${
        refundAmount > 0
          ? `We've refunded <strong>${usd(refundAmount, currency)}</strong> to the card you paid with. It usually shows within 5 to 10 business days.`
          : "No payment was taken for this order, so there is nothing to refund."
      }</p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">Your gang sheet is still saved in your account if you want to order it again.</p>
    </div>
  `;
  try {
    return await sendEmail({ to, subject: `Your Space Transfers order ${number} was cancelled`, html });
  } catch (err: any) {
    console.warn(`[ORDER_EMAIL] order ${number} cancellation email failed: ${err?.message}`);
    return null;
  }
};

const wrap = (heading: string, paragraphs: string[], footer?: string) => `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 560px;">
      <h2 style="margin: 0 0 8px 0;">${heading}</h2>
      ${paragraphs.map((p) => `<p style="margin: 0 0 12px 0;">${p}</p>`).join("\n      ")}
      ${footer ? `<p style="margin: 0; font-size: 12px; color: #6b7280;">${footer}</p>` : ""}
    </div>
  `;

const quoted = (text: string) =>
  `<span style="display: block; padding: 10px 12px; background: #f3f4f6; border-radius: 8px; white-space: pre-wrap;">${esc(text)}</span>`;

const ORDER_HISTORY_HINT = "You can follow this and reply from Order History in your Space Transfers account.";

const deliver = async (order: any, subject: string, html: string, what: string): Promise<EmailResult | null> => {
  const to = String(order?.customer?.email || "").trim();
  if (!to) return null;
  try {
    return await sendEmail({ to, subject, html });
  } catch (err: any) {
    console.warn(`[ORDER_EMAIL] order ${String(order?.displayId || order?._id || "")} ${what} email failed: ${err?.message}`);
    return null;
  }
};

/** Tells the customer money was returned on an order that still stands. Never throws. */
export const sendOrderRefundedEmail = async (
  order: any,
  refund: { amount: number; totalRefunded: number; full: boolean },
  reason: string,
): Promise<EmailResult | null> => {
  const number = String(order?.displayId || order?._id || "");
  const currency = String(order?.pricing?.currency || "USD");
  const html = wrap(
    `We've refunded ${esc(usd(refund.amount, currency))} on order ${esc(number)}`,
    [
      esc(reason),
      `The refund goes back to the card you paid with and usually shows within 5 to 10 business days.${
        refund.full
          ? " This order is now refunded in full."
          : refund.totalRefunded > refund.amount
            ? ` In total, ${esc(usd(refund.totalRefunded, currency))} has been refunded on this order.`
            : ""
      }`,
    ],
  );
  return deliver(order, `Refund for your Space Transfers order ${number}`, html, "refund");
};

/** Confirms a reported problem reached us. Never throws. */
export const sendIssueReceivedEmail = async (order: any, typeLabel: string, description: string): Promise<EmailResult | null> => {
  const number = String(order?.displayId || order?._id || "");
  const html = wrap(
    `We've got your report on order ${esc(number)}`,
    [`<strong>${esc(typeLabel)}</strong>`, ...(description ? [quoted(description)] : []), "Our team will look into it and get back to you."],
    ORDER_HISTORY_HINT,
  );
  return deliver(order, `We received your report on order ${number}`, html, "issue received");
};

/** Carries the admin's reply to the customer. Never throws. */
export const sendIssueReplyEmail = async (order: any, body: string): Promise<EmailResult | null> => {
  const number = String(order?.displayId || order?._id || "");
  const html = wrap(`A reply about your order ${esc(number)}`, [quoted(body)], ORDER_HISTORY_HINT);
  return deliver(order, `Reply about your Space Transfers order ${number}`, html, "issue reply");
};

/** Tells the customer how their report was settled. Never throws. */
export const sendIssueResolvedEmail = async (
  order: any,
  outcome: { kind: "REFUND" | "REPRINT" | "NONE"; note: string; refundAmount?: number; reprintDisplayId?: string },
): Promise<EmailResult | null> => {
  const number = String(order?.displayId || order?._id || "");
  const currency = String(order?.pricing?.currency || "USD");
  const what =
    outcome.kind === "REFUND"
      ? `We've refunded <strong>${esc(usd(outcome.refundAmount || 0, currency))}</strong> to the card you paid with. It usually shows within 5 to 10 business days.`
      : outcome.kind === "REPRINT"
        ? `We're reprinting your order free of charge. The replacement is order <strong>${esc(outcome.reprintDisplayId || "")}</strong> and ships to the same address.`
        : "We've closed this report.";
  const html = wrap(
    `Your report on order ${esc(number)} has been resolved`,
    [what, ...(outcome.note ? [quoted(outcome.note)] : [])],
    "If this hasn't put things right, reply from Order History and we'll reopen it.",
  );
  return deliver(order, `Update on your Space Transfers order ${number}`, html, "issue resolved");
};

/** Tells the customer their partner can't cancel the order, and why. Never throws. */
export const sendCancellationDeclinedEmail = async (order: any, reason: string): Promise<EmailResult | null> => {
  const number = String(order?.displayId || order?._id || "");
  return deliver(
    order,
    `Your order ${number} can't be cancelled`,
    wrap(
      `Your order ${esc(number)} can't be cancelled`,
      [
        "We asked the partner printing your order to cancel it, but it's too far along. They said:",
        quoted(reason),
        "Your order will carry on and ship as normal, and you haven't been charged anything extra.",
      ],
      "If this is a problem, reply to this email and we'll help.",
    ),
    "cancellation declined",
  );
};

/** Tells a customer about their rights dispute: a reply, or the decision. Never throws. */
export const sendRightsDisputeEmail = async (
  to: string,
  subject: string,
  heading: string,
  paragraphs: string[],
  quote?: string,
): Promise<EmailResult | null> => {
  if (!to) return null;
  const html = wrap(esc(heading), [...paragraphs.map(esc), ...(quote ? [quoted(quote)] : [])], "You can reply from the editor: Rights reviews, in your account menu.");
  try {
    return await sendEmail({ to, subject, html });
  } catch (err: any) {
    console.warn(`[EMAIL] rights dispute email failed: ${err?.message}`);
    return null;
  }
};

