import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

function makeClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const adapter = new PrismaPg({ connectionString: url });
    return new PrismaClient({ adapter });
  }

  // Local SQLite path: strip the file: prefix that Prisma uses
  const sqlitePath = url.replace(/^file:/, "");
  const adapter = new PrismaBetterSqlite3({ url: sqlitePath });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
