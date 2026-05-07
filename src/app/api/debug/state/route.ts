import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addDays } from "date-fns";

// Calendar snapshot — used by the Claude-Code-on-Mac side to plan edits
// without going through the paid chat backend. Returns enough context to
// reference calendars + events by id and decide what to change.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "21");
  const since = new Date();
  const until = addDays(since, days);

  const [accounts, calendars, events, goals, settings] = await Promise.all([
    db.account.findMany({
      select: { id: true, source: true, label: true, lastSyncAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.calendar.findMany({
      include: { account: { select: { source: true, label: true } }, _count: { select: { events: true } } },
      orderBy: [{ section: "asc" }, { name: "asc" }],
    }),
    db.event.findMany({
      where: {
        AND: [{ start: { lt: until } }, { end: { gt: since } }],
        calendar: { enabled: true },
      },
      include: { calendar: { select: { name: true, section: true } } },
      orderBy: { start: "asc" },
    }),
    db.progressGoal.findMany({}),
    db.settings.findUnique({ where: { id: "settings" } }),
  ]);

  return NextResponse.json({
    now: new Date().toISOString(),
    timezone: settings?.timezone ?? "America/Toronto",
    accounts,
    calendars: calendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      enabled: c.enabled,
      section: c.section,
      source: c.account.source,
      accountLabel: c.account.label,
      eventCount: c._count.events,
    })),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
      allDay: e.allDay,
      rrule: e.rrule,
      kind: e.kind,
      calendarId: e.calendarId,
      calendarName: e.calendar.name,
      section: e.calendar.section,
      notes: e.notes,
    })),
    goals,
  });
}
