import mongoose from "mongoose";
import { env } from "./env.js";

export const connectToDatabase = async (): Promise<void> => {
  try {
    mongoose.set("bufferCommands", false);
    await mongoose.connect(env.mongoUri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      family: 4
    });
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error", error);
    throw error;
  }
};
