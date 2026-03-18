import { Request, Response, NextFunction } from "express";

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.status(404).json({ message: "Not found" });
};

export interface CustomError extends Error {
  statusCode?: number;
}

export const errorHandler = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";
  res.status(statusCode).json({ message });
};
