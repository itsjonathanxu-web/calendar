import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const calendarId = String(form.get("calendarId") ?? "");
  const enabled = form.get("enabled") === "1";
  if (calendarId) {
    await db.calendar.update({
      where: { id: calendarId },
      data: { enabled },
    });
  }
  const back = request.headers.get("referer") ?? new URL("/calendar", request.url).toString();
  return NextResponse.redirect(back, { status: 303 });
}
