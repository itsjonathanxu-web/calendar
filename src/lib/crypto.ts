import { gcm } from "@noble/ciphers/aes.js";
import { hexToBytes, bytesToHex, utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils.js";
import { randomBytes as nodeRandomBytes } from "node:crypto";

function getKey(): Uint8Array {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("ENCRYPTION_KEY missing — set a 32-byte hex string in .env");
  }
  const key = hexToBytes(hex);
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  return key;
}

function rand(n: number): Uint8Array {
  const buf = nodeRandomBytes(n);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function encrypt(plaintext: string): string {
  const nonce = rand(12);
  const cipher = gcm(getKey(), nonce);
  const ct = cipher.encrypt(utf8ToBytes(plaintext));
  return `${bytesToHex(nonce)}:${bytesToHex(ct)}`;
}

export function decrypt(payload: string): string {
  const [nonceHex, ctHex] = payload.split(":");
  if (!nonceHex || !ctHex) throw new Error("Malformed ciphertext");
  const cipher = gcm(getKey(), hexToBytes(nonceHex));
  return bytesToUtf8(cipher.decrypt(hexToBytes(ctHex)));
}

export function generateKeyHex(): string {
  return bytesToHex(rand(32));
}
