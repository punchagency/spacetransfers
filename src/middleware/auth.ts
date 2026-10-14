import { Request, Response, NextFunction } from "express";
import { isLiveSession, verifyJwt } from "../utils/jwt.js";
import { User, IUser } from "../models/user.model.js";
import { mustEnrollPasskey } from "../services/passkey.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

/**
 * The only requests that may carry the session in the address: a browser
 * saving a file, which cannot send a header. An address ends up in history and
 * in logs, so everything else must use the Authorization header.
 */
const DOWNLOAD_PATHS = [/^\/api\/printer\/exports\/[^/]+\/file$/, /^\/api\/printer\/jobs\/[^/]+\/assets\/bundle\/download$/];

export const isDownloadRequest = (method: string, path: string): boolean =>
  method === "GET" && DOWNLOAD_PATHS.some((p) => p.test(path));

const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.substring("Bearer ".length);
  }
  if (!isDownloadRequest(req.method, (req.baseUrl || "") + req.path)) return null;
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
    // Ended by a password change or a passkey reset, or the account was suspended.
    if (!isLiveSession(payload, user)) {
      return res.status(401).json({ message: "Your session has ended. Please sign in again." });
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
      if (user && isLiveSession(payload, user)) {
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

/**
 * Keeps an admin who has not set a passkey up out of the console's data. They
 * can still reach the passkey endpoints, which is all they need to fix it.
 */
export const requireAdminPasskey = (req: Request, res: Response, next: NextFunction) => {
  if (req.user && mustEnrollPasskey(req.user)) {
    return res.status(403).json({ message: "Set up a passkey to continue.", code: "PASSKEY_REQUIRED" });
  }
  next();
};
