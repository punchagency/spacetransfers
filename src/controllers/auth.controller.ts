import { Request, Response, NextFunction } from "express";
import {
  loginUser,
  registerUser,
  getCurrentUser,
  listSubAccounts,
  createSubAccount,
  deleteSubAccount,
  switchSubAccount,
  requestPasswordReset,
  resetPassword
} from "../services/auth.service.js";

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getCurrentUser((req as any).user.id);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const getSubAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subAccounts = await listSubAccounts((req as any).user.id);
    res.json(subAccounts);
  } catch (error) {
    next(error);
  }
};

export const addSubAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createSubAccount((req as any).user.id, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const removeSubAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subAccountId = String((req as any).params?.id);
    await deleteSubAccount((req as any).user.id, subAccountId);
    res.json({ message: "Sub-account deleted successfully." });
  } catch (error) {
    next(error);
  }
};

export const switchAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { targetUserId } = req.body;
    const result = await switchSubAccount((req as any).user.id, targetUserId);
    res.json({ ...result, message: `Switched to ${result.user.name}'s account` });
  } catch (error) {
    next(error);
  }
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, role, companyName, phone } = req.body;
    const result = await registerUser({ name, email, password, role, companyName, phone });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser({ email, password });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    const result = await requestPasswordReset(email);
    res.json({
      message: "If an account exists for that email, a reset link has been sent.",
      ...result
    });
  } catch (error) {
    next(error);
  }
};

export const resetPasswordController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;
    await resetPassword({ token, newPassword });
    res.json({ message: "Password has been reset successfully." });
  } catch (error) {
    next(error);
  }
};
