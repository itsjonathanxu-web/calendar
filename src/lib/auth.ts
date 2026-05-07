import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { cookies } from "next/headers";

const COOKIE = "cal_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const v = process.env.SESSION_SECRET;
  if (!v) throw new Error("SESSION_SECRET missing in .env");
  return utf8ToBytes(v);
}

function sign(payload: string): string {
  return bytesToHex(hmac(sha256, secret(), utf8ToBytes(payload)));
}

export function makeSessionToken(): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [, expStr, mac] = parts;
  const payload = `v1.${expStr}`;
  if (sign(payload) !== mac) return false;
  const exp = Number(expStr);
  if (!exp || exp * 1000 < Date.now()) return false;
  return true;
}

export async function setSessionCookie() {
  const c = await cookies();
  c.set(COOKIE, makeSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(COOKIE);
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return verifySessionToken(c.get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  if (input.length !== expected.length) return false;
  // constant-time compare
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}
