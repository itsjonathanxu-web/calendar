import { gcm } from "@noble/ciphers/aes.js";
import { hexToBytes, bytesToHex, utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils.js";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { loadOrCreateKey } from "@/lib/key-store";

function getKey(): Uint8Array {
  // Key lives on the persistent volume (`/app/data/secrets/master.key`), not
  // in env. On fresh installs one is generated; on existing installs the
  // legacy ENCRYPTION_KEY env var is migrated to disk on first read.
  return loadOrCreateKey();
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
