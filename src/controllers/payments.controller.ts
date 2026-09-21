import { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import { priceItems } from "../services/pricing.service.js";

interface CustomError extends Error {
  statusCode?: number;
}

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

    const { items, shippingMethod, shippingAddress } = req.body || {};
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

    // The address is passed so the intent is built from the same live carrier
    // quote the order will use. Without it the intent would price shipping from
    // the flat fallback and then disagree with what gets recorded.
    const totals = await priceItems(items, shippingMethod, {
      state: String(shippingAddress?.state || ""),
      postalCode: String(shippingAddress?.postalCode || ""),
      country: String(shippingAddress?.country || "US"),
      city: shippingAddress?.city ? String(shippingAddress.city) : undefined,
    });
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
