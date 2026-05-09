import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildIcs, type IcsEvent } from "@/lib/calendar/ics";
import { expandRRule, instanceId } from "@/lib/calendar/recurrence";

// Always run at request time — feed must reflect latest writes.
export const dynamic = "force-dynamic";

// Read window: ±90 days back, +540 forward. iCloud refreshes the subscription
// every ~hour by default; we want enough horizon that long-term events show.
const BACK_DAYS = 90;
const FORWARD_DAYS = 540;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  const expected = settings?.feedToken;
  if (!expected) {
    return NextResponse.json(
      { error: "feed_not_initialized", hint: "Visit /settings to enable the calendar feed." },
      { status: 503 },
    );
  }
  if (token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - BACK_DAYS * 86400_000);
  const windowEnd = new Date(now.getTime() + FORWARD_DAYS * 86400_000);

  // Day-only "Just for today" notes are private and not for the iCloud feed.
  const dayOnlyCalRows = await db.calendar.findMany({
    where: { config: { contains: "dayOnly" } },
    select: { id: true },
  });
  const dayOnlyCalIds = dayOnlyCalRows.map((c) => c.id);

  // Completed tasks bucket — also skip; iCloud doesn't need a graveyard.
  const completedRows = await db.calendar.findMany({
    where: { name: "✓ Completed" },
    select: { id: true },
  });
  const skipIds = [...dayOnlyCalIds, ...completedRows.map((c) => c.id)];

  const [nonRecurring, masters, overrides] = await Promise.all([
    db.event.findMany({
      where: {
        AND: [{ start: { lt: windowEnd } }, { end: { gt: windowStart } }],
        rrule: null,
        recurrenceParentId: null,
        calendarId: { notIn: skipIds },
        calendar: { enabled: true },
      },
    }),
    db.event.findMany({
      where: {
        rrule: { not: null },
        recurrenceParentId: null,
        calendarId: { notIn: skipIds },
        calendar: { enabled: true },
      },
    }),
    db.event.findMany({
      where: {
        AND: [{ start: { lt: windowEnd } }, { end: { gt: windowStart } }],
        recurrenceParentId: { not: null },
        calendarId: { notIn: skipIds },
        calendar: { enabled: true },
      },
    }),
  ]);

  const overrideKeys = new Set(
    overrides.map((o) => `${o.recurrenceParentId}::${o.start.toISOString()}`),
  );

  const events: IcsEvent[] = [];

  for (const ev of nonRecurring) {
    if (ev.kind === "skipped") continue;
    events.push({
      uid: stableUid(ev.id),
      title: ev.title,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      notes: ev.notes,
    });
  }

  for (const ov of overrides) {
    if (ov.kind === "skipped") continue; // user removed this occurrence
    events.push({
      uid: stableUid(ov.id),
      title: ov.title,
      start: ov.start,
      end: ov.end,
      allDay: ov.allDay,
      notes: ov.notes,
    });
  }

  for (const master of masters) {
    if (!master.rrule) continue;
    const dur = master.end.getTime() - master.start.getTime();
    const occurrences = expandRRule(master.start, master.rrule, windowStart, windowEnd);
    for (const occ of occurrences) {
      if (overrideKeys.has(`${master.id}::${occ.toISOString()}`)) continue;
      events.push({
        uid: stableUid(instanceId(master.id, occ)),
        title: master.title,
        start: occ,
        end: new Date(occ.getTime() + dur),
        allDay: master.allDay,
        notes: master.notes,
      });
    }
  }

  const ics = buildIcs({
    prodId: "-//Jonathan Xu//Unified Calendar//EN",
    calName: "Unified Calendar",
    events,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": 'inline; filename="unified-calendar.ics"',
    },
  });
}

function stableUid(id: string): string {
  // RFC 5545 wants a globally-unique UID. The Prisma id is unique within this
  // app; suffix a domain so external clients don't ever conflict.
  return `${id}@unified-calendar.local`;
}
