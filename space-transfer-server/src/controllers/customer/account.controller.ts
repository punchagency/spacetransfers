import { Request, Response, NextFunction } from "express";
import { buildAccountExport, deleteCustomerAccount } from "../../services/accountData.service.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";

/** A copy of everything held about the signed-in customer, as a file. */
export const exportAccountData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await buildAccountExport(String(req.user?.id));
    res.setHeader("Content-Disposition", `attachment; filename="space-transfers-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/** Closes the signed-in customer's account. */
export const deleteAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String(req.user?.email || "");
    const result = await deleteCustomerAccount(String(req.user?.id), { password: req.body?.password, email: req.body?.email });
    notifyAllAdmins({
      category: "system",
      priority: "low",
      title: "Customer closed their account",
      message: `${email} closed their account. ${result.ordersKept} past order${result.ordersKept === 1 ? " was" : "s were"} kept.`,
      meta: { type: "account_deleted" },
    }).catch(() => {});
    res.json({ deleted: true, ...result });
  } catch (error) {
    next(error);
  }
};
