import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Lightweight calendar metadata for the chat summary. Returns id + name +
// color so the client can render a colored chip per change without an extra
// per-event lookup.
export async function GET() {
  const calendars = await db.calendar.findMany({
    select: { id: true, name: true, color: true, section: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ calendars });
}
