import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";

/**
 * The server's price for the cart — the same figures the card is charged.
 *
 * Checkout used to show flat shipping rates while the charge used the live
 * carrier rate for the address, so once carrier rates were on, the customer
 * paid a shipping figure they had never been shown. This asks the server's
 * quote (priced by the same function as the charge) once the address is known.
 */

export type ShippingMethod = "standard" | "express";

export interface CheckoutQuote {
  subtotal: number;
  rushSurcharge: number;
  shippingCost: number;
  /** e.g. "USPS Ground Advantage"; null when the flat rate was used. */
  shippingService: string | null;
  shippingSource: "carrier" | "fallback" | string;
  tax: number;
  total: number;
}

/** Cart lines as the server prices them — shared by the quote and the charge. */
export const toPricedItems = (cartItems: any[]) =>
  cartItems.map((item) => ({
    type: item.type || "gangsheet",
    designId: item.designId || item.id?.toString(),
    name: item.name || "Gang Sheet",
    widthIn: item.widthIn || 0,
    heightIn: item.heightIn || 0,
    quantity: item.quantity || item.copies || 1,
    unitPrice: item.price || 0,
  }));

export interface QuoteAddress {
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * Quotes both shipping methods for the cart and address, so the picker can
 * price each option and switching between them is instant.
 *
 * `enabled` should be false until the address is complete — a quote without a
 * destination is only the flat rate again. Requests wait for typing to settle.
 */
export const useCheckoutQuote = (
  cartItems: any[],
  address: QuoteAddress,
  enabled: boolean,
): { quotes: Partial<Record<ShippingMethod, CheckoutQuote>>; loading: boolean } => {
  const items = useMemo(() => toPricedItems(cartItems), [cartItems]);
  const key = enabled
    ? JSON.stringify({
        items: items.map((i) => [i.designId, i.widthIn, i.heightIn, i.quantity]),
        address: [address.city, address.state, address.postalCode, address.country],
      })
    : "";
  const [result, setResult] = useState<{ key: string; quotes: Partial<Record<ShippingMethod, CheckoutQuote>> }>({
    key: "",
    quotes: {},
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const ask = (method: ShippingMethod) =>
        apiFetch("/customer/cart/quote", {
          method: "POST",
          body: JSON.stringify({
            items,
            shippingMethod: method,
            shippingCity: address.city,
            shippingState: address.state,
            shippingPostalCode: address.postalCode,
            shippingCountry: address.country,
          }),
        }).then((r) => (r && Number.isFinite(Number(r.total)) ? (r as CheckoutQuote) : undefined))
          .catch(() => undefined);
      const [standard, express] = await Promise.all([ask("standard"), ask("express")]);
      if (!cancelled) setResult({ key, quotes: { standard, express } });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` captures everything the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = key && result.key === key;
  return { quotes: current ? result.quotes : {}, loading: Boolean(key) && !current };
};
