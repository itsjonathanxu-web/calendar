import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pull } from "@/lib/sources/google";

export async function POST(request: Request) {
  const form = await request.formData();
  const accountId = String(form.get("accountId") ?? "");
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account || account.source !== "google") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const result = await pull(accountId);
    const url = new URL("/settings", request.url);
    url.searchParams.set("synced", "google");
    url.searchParams.set("count", String(result.events));
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    console.error("Google sync failed:", err);
    const url = new URL("/settings", request.url);
    url.searchParams.set("error", "google_sync_failed");
    return NextResponse.redirect(url, { status: 303 });
  }
}
