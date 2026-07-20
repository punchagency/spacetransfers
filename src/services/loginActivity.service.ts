import type { Request } from "express";
import mongoose from "mongoose";
import { LoginActivity, type LoginActivityStatus } from "../models/loginActivity.model.js";

/**
 * Records who signed in, from where and on what device, for the Security →
 * Login Activity History view. Best-effort: recording must never block or break
 * a login, so callers fire-and-forget and every failure is swallowed here.
 */

/** Pulls the closest thing to the real client IP we have, proxy-aware. */
export const extractClientIp = (req: Request): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    // x-forwarded-for is a comma-separated list; the first entry is the client.
    return fwd.split(",")[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return String(fwd[0]).trim();
  }
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "") || "";
};

/** Turns a raw User-Agent string into a human label like "Chrome on macOS". */
export const parseDevice = (ua: string): string => {
  if (!ua) return "Unknown device";

  const browser =
    /Edg\//i.test(ua) ? "Edge" :
    /OPR\/|Opera/i.test(ua) ? "Opera" :
    /Chrome\//i.test(ua) && !/Chromium/i.test(ua) ? "Chrome" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Safari\//i.test(ua) && /Version\//i.test(ua) ? "Safari" :
    "Browser";

  const os =
    /iPhone/i.test(ua) ? "iPhone" :
    /iPad/i.test(ua) ? "iPad" :
    /Android/i.test(ua) ? "Android" :
    /Mac OS X|Macintosh/i.test(ua) ? "macOS" :
    /Windows/i.test(ua) ? "Windows" :
    /Linux/i.test(ua) ? "Linux" :
    "Unknown OS";

  return `${browser} on ${os}`;
};

const isPrivateOrLoopback = (ip: string): boolean => {
  if (!ip) return true;
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith("fe80:") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
};

/**
 * Resolves the real public IP and a "City, Country" location via a free,
 * key-less geo-IP service (ipwho.is, HTTPS).
 *
 * When the client IP is loopback/private (local development, where the browser
 * talks to the server over ::1) we look up the *server's own* public IP, which
 * in that setup is the developer's real IP and location — so the history shows
 * the correct place instead of "Local network". In production behind a proxy,
 * the client's real public IP arrives via X-Forwarded-For and is geo-located
 * directly.
 *
 * Always degrades gracefully: on timeout/failure it returns the best offline
 * value so a login is never delayed or blocked by this lookup.
 */
export const resolveGeo = async (
  clientIp: string
): Promise<{ ip: string; location: string }> => {
  const isLocal = isPrivateOrLoopback(clientIp);
  // No IP path → ipwho.is resolves the caller's (server's) own public IP.
  const url = isLocal
    ? "https://ipwho.is/"
    : `https://ipwho.is/${encodeURIComponent(clientIp)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`geo_http_${res.status}`);
    const data: any = await res.json();
    if (!data || data.success === false) throw new Error("geo_lookup_failed");

    const location =
      [data.city, data.country].filter(Boolean).join(", ") || "Unknown";
    // In the local-dev case, trust the resolved public IP over the loopback one.
    const ip = isLocal ? String(data.ip || clientIp || "Unknown") : clientIp;

    return { ip: ip || "Unknown", location };
  } catch {
    return {
      ip: clientIp || "Unknown",
      location: isLocal ? "Local network" : "Unknown"
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const recordLoginActivity = async ({
  req,
  userId,
  status
}: {
  req: Request;
  userId: string;
  status: LoginActivityStatus;
}): Promise<void> => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) return;
    const ua = String(req.headers["user-agent"] || "");
    const rawIp = extractClientIp(req);
    const { ip, location } = await resolveGeo(rawIp);

    await LoginActivity.create({
      userId: new mongoose.Types.ObjectId(userId),
      device: parseDevice(ua),
      ip,
      location,
      status,
      userAgent: ua
    });
  } catch {
    /* recording is best-effort — never surface an error to the login flow */
  }
};
