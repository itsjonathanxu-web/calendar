import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pull as pullGoogle } from "@/lib/sources/google";
import { pull as pullNotion } from "@/lib/sources/notion";

export async function POST(request: Request) {
  // Apple/iCloud has been retired in favor of the local-first ICS feed
  // (/api/feed.ics) — old apple Account rows are ignored here.
  const accounts = await db.account.findMany();
  for (const a of accounts) {
    try {
      if (a.source === "google") await pullGoogle(a.id);
      else if (a.source === "notion") await pullNotion(a.id);
    } catch (e) {
      console.error(`sync failed for ${a.source}/${a.label}:`, e);
    }
  }
  const back = request.headers.get("referer") ?? new URL("/calendar", request.url).toString();
  return NextResponse.redirect(back, { status: 303 });
}
