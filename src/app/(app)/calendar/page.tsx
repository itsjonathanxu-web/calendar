import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { db } from "@/lib/db";
import {
  isoDate,
  parseAnchor,
  type Block,
} from "@/lib/calendar/week";
import { rangeForView, shiftAnchor, monthDays, VIEWS, type ViewName } from "@/lib/calendar/views";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { FilterSidebar } from "@/components/calendar/FilterSidebar";
import { ChatToggle } from "@/components/calendar/ChatToggle";
import { NewEventButton } from "@/components/calendar/NewEventButton";

const VIEW_LABEL: Record<ViewName, string> = {
  week: "Week",
  month: "Month",
};

function parseView(v: string | undefined): ViewName {
  return (VIEWS as string[]).includes(v ?? "") ? (v as ViewName) : "week";
}

function localDayKey(d: Date): string {
  // YYYY-MM-DD using LOCAL calendar (server is UTC; that's fine for dates pulled from URL anchor + index math).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; view?: string; tm?: string }>;
}) {
  const { w, view: viewParam, tm } = await searchParams;
  const view = parseView(viewParam);
  const anchor = parseAnchor(w);
  const taskMode = tm === "1";
  const { start, end } = rangeForView(view, anchor);

  // Pull non-recurring events that overlap the window AND any recurring masters
  // (their start may be earlier than the window — we expand them below).
  const nonRecurring = await db.event.findMany({
    where: {
      AND: [{ start: { lt: end } }, { end: { gt: start } }],
      rrule: null,
      recurrenceParentId: null,
      calendar: { enabled: true },
    },
    include: { calendar: { include: { account: true } } },
    orderBy: { start: "asc" },
  });

  const masters = await db.event.findMany({
    where: {
      rrule: { not: null },
      recurrenceParentId: null,
      calendar: { enabled: true },
    },
    include: { calendar: { include: { account: true } } },
  });

  const overrides = await db.event.findMany({
    where: {
      AND: [{ start: { lt: end } }, { end: { gt: start } }],
      recurrenceParentId: { not: null },
      calendar: { enabled: true },
    },
    include: { calendar: { include: { account: true } } },
  });

  // Expand each master into instances within the window, skipping dates that have an override.
  const { expandRRule, instanceId } = await import("@/lib/calendar/recurrence");
  type EventLike = (typeof nonRecurring)[number];
  const overrideKeys = new Set(
    overrides.map((o) => `${o.recurrenceParentId}::${o.start.toISOString()}`),
  );
  const expandedInstances: EventLike[] = [];
  for (const master of masters) {
    if (!master.rrule) continue;
    const dur = master.end.getTime() - master.start.getTime();
    const occurrences = expandRRule(master.start, master.rrule, start, end);
    for (const occ of occurrences) {
      if (overrideKeys.has(`${master.id}::${occ.toISOString()}`)) continue;
      // Synthesize an EventLike row keeping the master's metadata but with the new start/end + virtual id
      expandedInstances.push({
        ...master,
        id: instanceId(master.id, occ),
        start: occ,
        end: new Date(occ.getTime() + dur),
        rrule: null,
        recurrenceParentId: master.id,
      } as EventLike);
    }
  }

  const events = [...nonRecurring, ...overrides, ...expandedInstances].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  const writableCalendars = await db.calendar.findMany({
    where: { account: { source: { in: ["google", "notion-mcp"] } } },
    include: { account: true },
    orderBy: [{ account: { source: "asc" } }, { name: "asc" } ],
  });

  const calendarOptions = writableCalendars.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    source: c.account.source,
    accountLabel: c.account.label,
  }));

  const detailsById: Record<
    string,
    {
      id: string;
      title: string;
      notes: string | null;
      calendarId: string;
      calendarName: string;
      section: string;
      source: string;
      allDay: boolean;
      rrule: string | null;
      isInstance: boolean;
    }
  > = {};
  for (const ev of events) {
    detailsById[ev.id] = {
      id: ev.id,
      title: ev.title,
      notes: ev.notes,
      calendarId: ev.calendarId,
      calendarName: ev.calendar.name,
      section: (ev.calendar as unknown as { section?: string }).section ?? "scheduling",
      source: ev.calendar.account.source,
      allDay: ev.allDay,
      rrule: ev.rrule,
      // synthetic id includes "::"
      isInstance: ev.id.includes("::"),
    };
  }

  const blocks: Block[] = events
    .filter((e) => e.kind !== "skipped") // hide skipped recurrence overrides
    .map((e) => ({
      id: e.id,
      title: e.title,
      color: e.calendar.color,
      calendarName: e.calendar.name,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
    }));

  const accountCount = await db.account.count();

  const prev = isoDate(shiftAnchor(view, anchor, -1));
  const next = isoDate(shiftAnchor(view, anchor, 1));
  const today = isoDate(new Date());

  const heading = (() => {
    if (view === "month") return format(anchor, "MMMM yyyy");
    // week
    const sameMonth = start.getMonth() === end.getMonth();
    return sameMonth ? format(start, "MMMM yyyy") : `${format(start, "MMM")} – ${format(end, "MMM yyyy")}`;
  })();

  return (
    <div className="h-full flex">
      <FilterSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="glass-subtle flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold tracking-tight">{heading}</h1>
            <div className="flex items-center gap-1 text-[var(--color-fg-muted)]">
              <Link
                aria-label="Previous"
                href={`/calendar?view=${view}&w=${prev}`}
                className="p-1 rounded hover:bg-[var(--color-fg)]/[0.06]"
              >
                <ChevronLeft size={16} />
              </Link>
              <Link
                href={`/calendar?view=${view}&w=${today}`}
                className="text-xs px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-fg)]/[0.04]"
              >
                Today
              </Link>
              <Link
                aria-label="Next"
                href={`/calendar?view=${view}&w=${next}`}
                className="p-1 rounded hover:bg-[var(--color-fg)]/[0.06]"
              >
                <ChevronRight size={16} />
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={`/calendar?view=${v}&w=${isoDate(anchor)}`}
                className={
                  "px-2 py-1 rounded-md border border-[var(--color-border)] " +
                  (v === view
                    ? "bg-[var(--color-fg)]/[0.06] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-fg)]/[0.04]")
                }
              >
                {VIEW_LABEL[v]}
              </Link>
            ))}
            {calendarOptions.length > 0 && (
              <div className="ml-2">
                <NewEventButton calendars={calendarOptions} />
              </div>
            )}
            {accountCount > 0 && (
              <form action="/api/sync/all" method="post" className="ml-1">
                <button className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-fg)]/[0.04]">
                  <RefreshCw size={12} /> Sync
                </button>
              </form>
            )}
            <ChatToggle />
          </div>
        </header>

        {accountCount === 0 ? (
          <div className="flex-1 grid place-items-center text-center px-6">
            <div className="space-y-3 max-w-sm">
              <p className="text-sm text-[var(--color-fg-muted)]">
                No calendar sources connected yet.
              </p>
              <Link
                href="/settings"
                className="inline-block text-sm rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-1.5 font-medium"
              >
                Connect a source
              </Link>
            </div>
          </div>
        ) : view === "week" ? (
          <WeekGrid
            anchor={isoDate(anchor)}
            blocks={blocks.map((b) => ({
              ...b,
              start: b.start.toISOString(),
              end: b.end.toISOString(),
            }))}
            calendars={calendarOptions}
            detailsById={detailsById}
          />
        ) : (
          <MonthGrid
            days={monthDays(anchor).map((d) => localDayKey(d))}
            blocks={blocks.map((b) => ({
              ...b,
              start: b.start.toISOString(),
              end: b.end.toISOString(),
            }))}
            monthAnchor={isoDate(anchor)}
            calendars={calendarOptions}
            detailsById={detailsById}
            taskMode={taskMode}
          />
        )}
      </div>
    </div>
  );
}

