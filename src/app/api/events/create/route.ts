import { NextResponse } from "next/server";
import { createEvent } from "@/lib/sources";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { calendarId, title, start, end, allDay, notes } = body as {
    calendarId?: string;
    title?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    notes?: string | null;
  };
  if (!calendarId || !title || !start || !end) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  try {
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
