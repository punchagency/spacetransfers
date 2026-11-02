import mongoose from "mongoose";
import { env } from "./env.js";
import { User } from "../models/user.model.js";

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

    try {
      await User.syncIndexes();
    } catch (err) {
      console.warn("User.syncIndexes failed", err);
    }
  } catch (error) {
    console.error("MongoDB connection error", error);
    throw error;
  }
};
