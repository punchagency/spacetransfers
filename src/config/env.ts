import dotenv from "dotenv";

dotenv.config();

interface Env {
  nodeEnv: string;
  port: number | string;
  mongoUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
}

export const env: Env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/space-transfer",
  jwtSecret: process.env.JWT_SECRET || "change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d"
};
