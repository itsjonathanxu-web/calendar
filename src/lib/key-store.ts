import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hexToBytes, bytesToHex } from "@noble/ciphers/utils.js";

// Where the master key lives — on the persistent volume, not the env. Env-only
// keys leak with the deploy environment; volume keys require disk access. The
// volume is also where credentials are stored (in the SQLite DB), so the threat
// model now requires the attacker to already have full read access — at which
// point everything is compromised regardless.
const KEY_DIR = process.env.KEY_DIR ?? "/app/data/secrets";
const KEY_PATH = path.join(KEY_DIR, "master.key");

let cached: Uint8Array | null = null;

export function loadOrCreateKey(): Uint8Array {
  if (cached) return cached;

  // 1. Volume file wins
  if (existsSync(KEY_PATH)) {
    const hex = readFileSync(KEY_PATH, "utf8").trim();
    const buf = hexToBytes(hex);
    if (buf.length !== 32) throw new Error(`master.key wrong length: ${buf.length}`);
    cached = buf;
    return cached;
  }

  mkdirSync(KEY_DIR, { recursive: true });

  // 2. Migration path: if the legacy ENCRYPTION_KEY env var is set, copy it to
  // the volume so credentials encrypted under it remain decryptable. After
  // this, the env var becomes optional.
  const envHex = process.env.ENCRYPTION_KEY;
  if (envHex) {
    const buf = hexToBytes(envHex);
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
    writeFileSync(KEY_PATH, envHex.trim() + "\n", { mode: 0o600 });
    try {
      chmodSync(KEY_PATH, 0o600);
    } catch {
      /* best effort */
    }
    console.log("[key-store] migrated ENCRYPTION_KEY env → volume file");
    cached = buf;
    return cached;
  }

  // 3. Fresh install — generate a new 32-byte key
  const newKey = randomBytes(32);
  const buf = new Uint8Array(newKey.buffer, newKey.byteOffset, newKey.byteLength);
  writeFileSync(KEY_PATH, bytesToHex(buf) + "\n", { mode: 0o600 });
  try {
    chmodSync(KEY_PATH, 0o600);
  } catch {
    /* best effort */
  }
  console.log("[key-store] generated new master.key on volume");
  cached = buf;
  return cached;
}
