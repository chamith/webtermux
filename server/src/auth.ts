import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import cookie from "cookie";
import { config } from "./config";

function sign(value: string): string {
  const hmac = crypto.createHmac("sha256", config.sessionSecret).update(value).digest("hex");
  return `${value}.${hmac}`;
}

function verify(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(value).digest("hex");
  const macBuf = Buffer.from(mac, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) {
    return null;
  }
  return value;
}

export async function checkPassword(password: string): Promise<boolean> {
  return bcrypt.compare(password, config.adminPasswordHash);
}

export function makeSessionCookie(): string {
  const payload = JSON.stringify({ exp: Date.now() + config.sessionMaxAgeMs });
  const token = sign(Buffer.from(payload).toString("base64url"));
  return cookie.serialize(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: config.sessionMaxAgeMs / 1000,
  });
}

export function clearSessionCookie(): string {
  return cookie.serialize(config.sessionCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  const value = verify(token);
  if (!value) return false;
  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  if (isValidToken(cookies[config.sessionCookieName])) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}

export function isRequestAuthenticated(cookieHeader: string | undefined): boolean {
  const cookies = cookie.parse(cookieHeader ?? "");
  return isValidToken(cookies[config.sessionCookieName]);
}
