import { Request, Response, NextFunction } from "express";

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.status(404).json({ message: "Not found" });
};

export interface CustomError extends Error {
  statusCode?: number;
}

export const errorHandler = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  const rawMessage = err.message || "Internal server error";
  const isDbDown =
    rawMessage.includes("ECONNREFUSED") ||
    rawMessage.includes("MongooseServerSelectionError") ||
    rawMessage.includes("MongoServerSelectionError") ||
    rawMessage.includes("connect ECONNREFUSED") ||
    rawMessage.includes("MongoDB connection error");

  const statusCode = err.statusCode || (isDbDown ? 503 : 500);
  const message = isDbDown
    ? "Database unavailable. Ensure MongoDB is running and MONGO_URI is set correctly."
    : rawMessage;
  res.status(statusCode).json({ message });
};
