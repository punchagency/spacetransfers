import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export const signJwt = (payload: string | object | Buffer): string => {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"]
  });
};

export const verifyJwt = (token: string): any => {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
};
