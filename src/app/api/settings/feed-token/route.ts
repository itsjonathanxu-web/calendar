import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

function newToken(): string {
  // 22-char URL-safe base64-ish — opaque, no need for users to type it.
  return randomBytes(16).toString("base64url");
}

export async function POST(request: Request) {
  const form = await request.formData();
  const action = String(form.get("action") ?? "ensure");
  // ensure → generate only if missing; rotate → always replace.
  const existing = await db.settings.findUnique({ where: { id: "settings" } });
  const should =
    action === "rotate" ? true : !existing?.feedToken;
  if (should) {
    await db.settings.upsert({
      where: { id: "settings" },
      create: { id: "settings", feedToken: newToken() },
      update: { feedToken: newToken() },
    });
  }
  return NextResponse.redirect(new URL("/settings", request.url), { status: 303 });
}
