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
