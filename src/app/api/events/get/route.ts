import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isInstanceId, parseInstanceId } from "@/lib/calendar/recurrence";

// Fetch a single event's current state. Used by the chat auto-apply flow to
// snapshot pre-change values for undo.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  // Synthetic recurring instance id — pull the master.
  const realId = isInstanceId(id) ? parseInstanceId(id)?.masterId ?? id : id;
  const ev = await db.event.findUnique({
    where: { id: realId },
    include: { calendar: { select: { id: true, name: true, color: true } } },
  });
  if (!ev) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    id: ev.id,
    title: ev.title,
    start: ev.start.toISOString(),
    end: ev.end.toISOString(),
    allDay: ev.allDay,
    notes: ev.notes,
    rrule: ev.rrule,
    calendarId: ev.calendarId,
    calendar: ev.calendar,
  });
}
