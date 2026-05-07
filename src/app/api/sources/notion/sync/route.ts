import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pull } from "@/lib/sources/notion";

export async function POST(request: Request) {
  const form = await request.formData();
  const accountId = String(form.get("accountId") ?? "");
  const account = await db.account.findUnique({ where: { id: accountId } });
  const settings = new URL("/settings", request.url);
  if (!account || account.source !== "notion") {
    settings.searchParams.set("error", "not_found");
    return NextResponse.redirect(settings, { status: 303 });
  }
  try {
    const result = await pull(accountId);
    settings.searchParams.set("synced", "notion");
    settings.searchParams.set("count", String(result.events));
  } catch (err) {
    console.error("Notion sync failed:", err);
    settings.searchParams.set("error", "notion_sync_failed");
  }
  return NextResponse.redirect(settings, { status: 303 });
}
