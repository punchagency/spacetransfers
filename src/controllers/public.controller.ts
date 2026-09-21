import { Request, Response, NextFunction } from "express";
import { User, UserRoles } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import { PAYOUT_ELIGIBLE_ORDER_STATUSES } from "../services/partnerEarnings.service.js";

/**
 * Network figures for the sign-in screen, which renders before anyone has a
 * session.
 *
 * Deliberately two integers and nothing else. This is the only unauthenticated
 * endpoint that touches business data, and the last one that existed — an
 * anonymous "recent activity" feed — leaked customer names, order totals and
 * timing to anyone who asked. Aggregate counts carry none of that, and the
 * shape here is the guard: there is no field to widen by accident.
 */

/**
 * These move slowly and the endpoint is public, so the answer is held briefly
 * rather than counting twice for every person who loads the login page.
 */
const CACHE_MS = 60_000;
let cache: { at: number; value: { activePartners: number; ordersFulfilled: number } } | null = null;

export const getPublicStats = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      res.status(200).json(cache.value);
      return;
    }

    const [activePartners, ordersFulfilled] = await Promise.all([
      // The same set assignment routes to, so the number on the banner and the
      // number of partners who can actually take work cannot disagree.
      User.countDocuments({ role: UserRoles.PRINTER, status: "Active" }),
      /*
       * "Fulfilled" is SHIPPED or COMPLETED — the print work is done and the
       * parcel has left. Reuses the payout-eligible set rather than restating
       * it, because that constant already defines "this order's work is real"
       * for earnings, and two definitions of done would drift.
       */
      Order.countDocuments({ status: { $in: PAYOUT_ELIGIBLE_ORDER_STATUSES as unknown as string[] } }),
    ]);

    const value = { activePartners, ordersFulfilled };
    cache = { at: Date.now(), value };
    res.status(200).json(value);
  } catch (error) {
    next(error);
  }
};
