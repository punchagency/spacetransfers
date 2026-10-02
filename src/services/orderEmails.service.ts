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
