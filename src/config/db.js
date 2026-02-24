import mongoose from "mongoose";
import { env } from "./env.js";

export const connectToDatabase = async () => {
  try {
    await mongoose.connect(env.mongoUri, {
      autoIndex: true
    });
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error", error);
    process.exit(1);
  }
};

