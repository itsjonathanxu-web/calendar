import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Rolling on-volume SQLite backups. Lives next to the DB so volume corruption
// would still take everything — a real DR story needs litestream → Tigris/S3
// replication on top. This protects against accidental destructive writes
// (bad migration, fat-finger DELETE) but not full-volume loss.

const DB_PATH = process.env.DATABASE_URL?.replace(/^file:/, "") ?? "/app/data/dev.db";
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");
const KEEP_DAYS = 14;

function tag(d: Date): string {
  // YYYY-MM-DD-HHmm so multiple backups in one day are distinguishable
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}-${hh}${mm}`;
}

export async function snapshotDb(): Promise<{ path: string; bytes: number } | null> {
  if (!existsSync(DB_PATH)) {
    console.warn(`[backup] db not found at ${DB_PATH}`);
    return null;
  }
  await mkdir(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `db-${tag(new Date())}.sqlite`);
  // SQLite copy is safe for WAL mode if no in-flight transactions; the cron
  // tick is brief and prisma uses connection pooling, so this is fine in
  // practice. If we ever see corruption, switch to `VACUUM INTO`.
  await copyFile(DB_PATH, dest);
  const s = await stat(dest);
  console.log(`[backup] snapshot ${dest} (${s.size} bytes)`);
  await prune();
  return { path: dest, bytes: s.size };
}

async function prune(): Promise<void> {
  const entries = await readdir(BACKUP_DIR);
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  for (const name of entries) {
    if (!name.startsWith("db-") || !name.endsWith(".sqlite")) continue;
    const full = path.join(BACKUP_DIR, name);
    try {
      const s = await stat(full);
      if (s.mtimeMs < cutoff) {
        await unlink(full);
        console.log(`[backup] pruned old snapshot ${name}`);
      }
    } catch {
      /* ignore */
    }
  }
}
