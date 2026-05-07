import { NextResponse } from "next/server";
import { saveAccount, pull } from "@/lib/sources/notion";

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "").trim();
  const settings = new URL("/settings", request.url);
  if (!token.startsWith("ntn_") && !token.startsWith("secret_")) {
    settings.searchParams.set("error", "notion_bad_token");
    return NextResponse.redirect(settings, { status: 303 });
  }
  try {
    const accountId = await saveAccount(token);
    // pull = discover databases AND immediately sync rows with date properties
    const { calendars, events } = await pull(accountId);
    settings.searchParams.set("connected", "notion");
    settings.searchParams.set("count", `${calendars} dbs · ${events} dated rows`);
  } catch (err) {
    console.error("Notion connect failed:", err);
    settings.searchParams.set("error", "notion_connect_failed");
  }
  return NextResponse.redirect(settings, { status: 303 });
}
