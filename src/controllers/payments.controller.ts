import { Request, Response, NextFunction } from "express";
import Stripe from "stripe";

interface CustomError extends Error {
  statusCode?: number;
}

const roundToTwo = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const computeTotals = (items: any[], shippingMethod: string) => {
  const subtotal = roundToTwo(
    items.reduce((sum, it) => {
      const qty =
        typeof it?.quantity === "number"
          ? it.quantity
          : typeof it?.copies === "number"
            ? it.copies
            : 1;
      const unit = typeof it?.unitPrice === "number" ? it.unitPrice : it?.price || 0;
      return sum + qty * unit;
    }, 0),
  );

  const shippingCost = shippingMethod === "express" ? 24.99 : 8.99;
  const tax = roundToTwo(subtotal * 0.08);
  const total = roundToTwo(subtotal + shippingCost + tax);
  return { subtotal, shippingCost, tax, total, currency: "USD" as const };
};

const getStripe = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
};

const paypalBaseUrl = () => {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
};

const getPaypalAccessToken = async () => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) return null;

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data: any = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || "Failed to get PayPal token");
  }
  return data.access_token as string;
};

export const createStripePaymentIntent = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      const error = new Error("Stripe is not configured") as CustomError;
      error.statusCode = 500;
      throw error;
    }

    const { items, shippingMethod } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("items array is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    if (!shippingMethod) {
      const error = new Error("shippingMethod is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const totals = computeTotals(items, shippingMethod);
    const amountCents = Math.max(1, Math.round(totals.total * 100));

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: totals.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: req.user?.id || "",
        shippingMethod: String(shippingMethod),
      },
    });

    res.status(201).json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amount: totals.total,
      currency: totals.currency,
      pricing: totals,
    });
  } catch (error) {
    next(error);
  }
};

export const createPaypalOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { items, shippingMethod } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("items array is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    if (!shippingMethod) {
      const error = new Error("shippingMethod is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const token = await getPaypalAccessToken();
    if (!token) {
      const error = new Error("PayPal is not configured") as CustomError;
      error.statusCode = 500;
      throw error;
    }

    const totals = computeTotals(items, shippingMethod);

    const resultRes = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: totals.currency,
              value: totals.total.toFixed(2),
            },
          },
        ],
      }),
    });

    const data: any = await resultRes.json();
    if (!resultRes.ok) {
      const error = new Error(data?.message || "Failed to create PayPal order") as CustomError;
      error.statusCode = 500;
      throw error;
    }

    res.status(201).json({
      paypalOrderId: data.id,
      pricing: totals,
      currency: totals.currency,
    });
  } catch (error) {
    next(error);
  }
};

export const capturePaypalOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { paypalOrderId } = req.body || {};
    if (!paypalOrderId || typeof paypalOrderId !== "string") {
      const error = new Error("paypalOrderId is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const token = await getPaypalAccessToken();
    if (!token) {
      const error = new Error("PayPal is not configured") as CustomError;
      error.statusCode = 500;
      throw error;
    }

    const resultRes = await fetch(
      `${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data: any = await resultRes.json();
    if (!resultRes.ok) {
      const error = new Error(data?.message || "Failed to capture PayPal order") as CustomError;
      error.statusCode = 500;
      throw error;
    }

    const captureId =
      data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

    res.status(200).json({
      paypalOrderId,
      paypalCaptureId: captureId,
      status: data?.status || null,
      raw: data,
    });
  } catch (error) {
    next(error);
  }
};
