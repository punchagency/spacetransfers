import { Request, Response, NextFunction } from "express";
import { User } from "../../models/user.model.js";
import { Design } from "../../models/design.model.js";
import { getGlobalPricing, priceItems, deriveItemUnitPrice, itemQuantity } from "../../services/pricing.service.js";
import { assertPersistable } from "../../utils/documentSize.js";
import { sendEmail } from "../../services/email.service.js";
import { CustomError, roundToTwo } from "./shared.js";

export const getCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select("cart");
    res.json({ cart: user?.cart || [] });
  } catch (error) {
    next(error);
  }
};

export const updateCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cart } = req.body || {};
    // The cart is a subdocument of the user, so an oversized cart takes the
    // whole user document over the limit — and the resulting failure would be
    // reported against `users`, not the cart, which is a confusing place to
    // start debugging.
    assertPersistable({ cart: cart || [] }, { label: "cart" });
    await User.updateOne({ _id: req.user?.id }, { $set: { cart: cart || [] } });
    res.json({ message: "Cart updated" });
  } catch (error) {
    next(error);
  }
};

export const getPricingConfig = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pricing = await getGlobalPricing();
    res.status(200).json({
      baseRatePerSqFt: pricing.baseRatePerSqFt,
      /*
       * The billing shape of a sheet, so the editor quotes what the server will
       * actually charge. Without these the editor priced the artwork's bounding
       * box while the server bills the roll — the customer would have been shown
       * one number and charged another.
       */
      sheetWidthIn: pricing.sheetWidthIn,
      minSheetLengthIn: pricing.minSheetLengthIn,
      // The storefront shows this as a line on express orders, so it has to
      // know the rate or the cart total would not match what is charged.
      rushSurchargePct: pricing.rushSurchargePct,
      shipping: pricing.shipping,
      taxRatePct: pricing.taxRatePct,
      currency: "USD",
    });
  } catch (error) {
    next(error);
  }
};

export const getCartQuote = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { items, shippingMethod, shippingCountry, shippingPostalCode } = req.body || {};

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

    if (!shippingCountry) {
      const error = new Error("shippingCountry is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingPostalCode) {
      const error = new Error("shippingPostalCode is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Read once, above the loop: the same rates must price every line item,
    // the shipping and the tax on this quote.
    // A quote may only be asked for sheets the customer owns.
    const designIds = items
      .filter((it: any) => String(it?.type || "gangsheet").toLowerCase() === "gangsheet")
      .map((it: any) => it?.designId);
    if (designIds.some((id: unknown) => !id)) {
      const error = new Error("designId is required for gangsheet items") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    const owned = await Design.countDocuments({ _id: { $in: [...new Set(designIds)] }, user: req.user?.id });
    if (owned !== new Set(designIds.map(String)).size) {
      const error = new Error("Design not found for cart item") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    // The same address fields the payment and the order send, so all three are priced alike.
    const totals = await priceItems(items, shippingMethod, {
      street: req.body?.shippingStreet ? String(req.body.shippingStreet) : undefined,
      state: String(req.body?.shippingState || ""),
      postalCode: String(shippingPostalCode || ""),
      country: String(shippingCountry || "US"),
      city: req.body?.shippingCity ? String(req.body.shippingCity) : undefined,
    });
    const pricing = await getGlobalPricing();

    res.status(200).json({
      items: items.map((it: any) => {
        const unitPrice = deriveItemUnitPrice(it, pricing);
        return {
          name: it?.name,
          unitPrice,
          quantity: itemQuantity(it),
          subtotal: roundToTwo(unitPrice * itemQuantity(it)),
        };
      }),
      subtotal: totals.subtotal,
      rushSurcharge: totals.rushSurcharge,
      shippingCost: totals.shippingCost,
      // Named so the storefront can say "USPS Ground Advantage" instead of just
      // a number, and so a fallback is visible rather than silent.
      shippingService: totals.shipping.serviceName,
      shippingSource: totals.shipping.source,
      tax: totals.tax,
      total: totals.total,
      currency: totals.currency
    });
  } catch (error) {
    next(error);
  }
};

export const sendGangsheetUtilizationWarning = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { billedPrice, sheetWidthIn, billedLengthIn, usedLengthIn } = req.body || {};

    const price = Number(billedPrice);
    const width = Number(sheetWidthIn);
    const billed = Number(billedLengthIn);
    const used = Number(usedLengthIn);
    if (![price, width, billed, used].every((n) => Number.isFinite(n) && n >= 0) || price <= 0) {
      const error = new Error("billedPrice, sheetWidthIn, billedLengthIn and usedLengthIn are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const subject = "Unused gang sheet space notice";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin: 0 0 12px 0;">Unused gang sheet space</h2>
        <p style="margin: 0 0 12px 0;">
          Your artwork is ${used.toFixed(2)}in long. Gang sheets are billed from a ${billed.toFixed(2)}in minimum,
          so this ${width.toFixed(2)}in &times; ${billed.toFixed(2)}in sheet costs <strong>$${price.toFixed(2)}</strong>.
        </p>
        <p style="margin: 0; color: #6B7280; font-size: 12px;">
          You can add more artwork to the same sheet at no extra cost until it reaches ${billed.toFixed(2)}in.
        </p>
      </div>
    `;

    const sendResult = await sendEmail({ to: user.email, subject, html });
    console.log(
      `[GANGSHEET_WARN] user=${user.id} used=${used}in billed=${billed}in price=$${price.toFixed(2)} sent=${sendResult.sent}`,
    );
    res.status(200).json({ sent: sendResult.sent });
  } catch (error) {
    next(error);
  }
};
