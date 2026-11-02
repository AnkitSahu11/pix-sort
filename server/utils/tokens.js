import crypto from "node:crypto";

export function rawToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token) {
  if (!token) return "";
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function generateOTP() {
  return String(crypto.randomInt(100000, 999999));
}
