import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const signJwt = (payload) => {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });
};

export const verifyJwt = (token) => {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
};

