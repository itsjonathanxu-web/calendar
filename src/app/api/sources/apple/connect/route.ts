import { NextResponse } from "next/server";
import { verifyAndSave, pull } from "@/lib/sources/apple";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "").trim();
  const settings = new URL("/settings", request.url);
  if (!username || !password) {
    settings.searchParams.set("error", "apple_missing");
    return NextResponse.redirect(settings, { status: 303 });
  }
  try {
    const accountId = await verifyAndSave({ username, password });
    const { calendars, events } = await pull(accountId);
    settings.searchParams.set("connected", "apple");
    settings.searchParams.set("count", `${calendars} cals · ${events} events`);
  } catch (err) {
    console.error("Apple connect failed:", err);
    settings.searchParams.set("error", "apple_connect_failed");
  }
  return NextResponse.redirect(settings, { status: 303 });
}
