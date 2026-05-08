import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Delete a calendar (category). Only safe for locally-created categories
// (notion-mcp source) — synced calendars (Google, Apple) shouldn't be deleted
// here because they re-appear on next sync. Cascades to delete events tied
// to the calendar via Prisma's onDelete: Cascade.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const cal = await db.calendar.findUnique({
    where: { id },
    include: { account: true, _count: { select: { events: true } } },
  });
  if (!cal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cal.account.source !== "notion-mcp") {
    return NextResponse.json(
      { error: "synced_calendar_not_deletable" },
      { status: 400 },
    );
  }

  // Delete events first (in case the schema doesn't have cascade), then the
  // calendar row itself.
  await db.event.deleteMany({ where: { calendarId: id } });
  await db.calendar.delete({ where: { id } });

  return NextResponse.json({ ok: true, deletedEvents: cal._count.events });
}
