import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

export const getHealth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? "up" : "down";
    
    const healthData = {
      status: "up",
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: dbStatus,
        },
        api: {
          status: "up",
        }
      }
    };

    if (dbStatus === "down") {
      return res.status(503).json(healthData);
    }

    res.status(200).json(healthData);
  } catch (error) {
    next(error);
  }
};
