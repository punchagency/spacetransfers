import type { Request, Response, NextFunction } from "express";
import { checkAddress } from "../../services/addressCheck.service.js";
import { CustomError } from "./shared.js";

/** Checkout asks whether the carrier can deliver to the address before payment. */
export const checkShippingAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const field = (name: string) => (typeof req.body?.[name] === "string" ? req.body[name].trim().slice(0, 200) : "");
    const address = { street: field("street"), city: field("city"), state: field("state"), postalCode: field("postalCode") };
    if (!address.street || !address.city || !address.state || !address.postalCode) {
      const error = new Error("street, city, state and postalCode are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    res.json(await checkAddress(address));
  } catch (error) {
    next(error);
  }
};
