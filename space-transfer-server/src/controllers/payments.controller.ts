import { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import { priceItems } from "../services/pricing.service.js";
import { checkImages, RIGHTS_STOP_MESSAGE, stoppedImages } from "../services/rights/screening.service.js";

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

    /*
     * Nothing is charged for artwork the rights check stopped: the card is
     * captured at payment, so this is where an order can still be held back.
     * The customer confirms the rights too, as the Content Policy asks.
     */
    if (req.body?.rightsConfirmed !== true) {
      const error = new Error("Please confirm that you have the rights to print this artwork.") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    const artworkUrls: string[] = Array.isArray(req.body?.artworkUrls)
      ? req.body.artworkUrls.filter((u: unknown): u is string => typeof u === "string").slice(0, 500)
      : [];
    if (artworkUrls.length === 0) {
      const error = new Error("Your artwork couldn't be checked. Please reload the page and try again.") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    const stopped = stoppedImages(await checkImages(String((req as any).user?.id || ""), artworkUrls));
    if (stopped.length) {
      return res.status(409).json({ message: RIGHTS_STOP_MESSAGE, code: "RIGHTS_REVIEW", images: stopped });
    }

    // The address is passed so the intent is built from the same live carrier
    // quote the order will use. Without it the intent would price shipping from
    // the flat fallback and then disagree with what gets recorded. The fields
    // match the order's, so EasyPost rates both alike.
    const totals = await priceItems(items, shippingMethod, {
      street: shippingAddress?.street ? String(shippingAddress.street) : undefined,
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
