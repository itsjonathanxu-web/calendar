import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createEvent } from "@/lib/sources";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { calendarId, title, start, end, allDay, notes, rrule } = body as {
    calendarId?: string;
    title?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    notes?: string | null;
    rrule?: string | null;
  };
  if (!calendarId || !title || !start || !end) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  try {
    // Recurring events are local-only. Create directly with rrule.
    if (rrule) {
      const cal = await db.calendar.findUnique({
        where: { id: calendarId },
        include: { account: true },
      });
      if (!cal) throw new Error("Calendar not found");
      if (cal.account.source !== "notion-mcp" && cal.account.source !== "apple") {
        return NextResponse.json(
          { error: "Recurring events only supported on category/Apple calendars" },
          { status: 400 },
        );
      }
      const ev = await db.event.create({
        data: {
          calendarId,
          sourceId: "local-" + Math.random().toString(36).slice(2, 12) + "-" + Date.now().toString(36),
          title,
          start: new Date(start),
          end: new Date(end),
          allDay: Boolean(allDay),
          notes: notes ?? null,
          kind: "task",
          rrule,
        },
      });
      return NextResponse.json({ ok: true, sourceId: ev.id });
    }

    const sourceId = await createEvent(calendarId, {
      title,
      start: new Date(start),
      end: new Date(end),
      allDay,
      notes,
    });
    return NextResponse.json({ ok: true, sourceId });
  } catch (err) {
    console.error("create event failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create_failed" },
      { status: 500 },
    );
  }
}
