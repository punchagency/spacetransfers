import { Request, Response, NextFunction } from "express";
import { verifyJwt } from "../utils/jwt.js";
import { User, IUser } from "../models/user.model.js";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

/**
 * Extract the bearer token from the Authorization header, falling back to a
 * `?token=` query parameter. The query fallback exists so that native browser
 * downloads (an <a download> / window.location navigation, which cannot set an
 * Authorization header) can still authenticate — this is what lets large file
 * exports stream straight to disk instead of being buffered in page memory.
 */
const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.substring("Bearer ".length);
  }
  const q = req.query?.token;
  if (typeof q === "string" && q.length > 0) return q;
  if (Array.isArray(q) && typeof q[0] === "string" && q[0].length > 0) return q[0];
  return null;
};

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const payload = verifyJwt(token);

    if (!payload || !payload.sub) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const user = await User.findById(payload.sub).select("-passwordHash");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

export const maybeAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return next();
    }

    const payload = verifyJwt(token);

    if (payload && payload.sub) {
      const user = await User.findById(payload.sub).select("-passwordHash");
      if (user) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    // If token is invalid, just proceed as guest
    next();
  }
};

export const requireRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    next();
  };
};
