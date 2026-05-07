import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pull as pullGoogle } from "@/lib/sources/google";
import { pull as pullNotion } from "@/lib/sources/notion";
import { pull as pullApple } from "@/lib/sources/apple";

export async function POST(request: Request) {
  const accounts = await db.account.findMany();
  for (const a of accounts) {
    try {
      if (a.source === "google") await pullGoogle(a.id);
      else if (a.source === "notion") await pullNotion(a.id);
      else if (a.source === "apple") await pullApple(a.id);
    } catch (e) {
      console.error(`sync failed for ${a.source}/${a.label}:`, e);
    }
  }
  const back = request.headers.get("referer") ?? new URL("/calendar", request.url).toString();
  return NextResponse.redirect(back, { status: 303 });
}
