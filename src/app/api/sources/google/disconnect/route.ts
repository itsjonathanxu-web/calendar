import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const accountId = String(form.get("accountId") ?? "");
  await db.account.deleteMany({ where: { id: accountId, source: "google" } });
  const url = new URL("/settings", request.url);
  url.searchParams.set("disconnected", "google");
  return NextResponse.redirect(url, { status: 303 });
}
