import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { addDays, format } from "date-fns";
import { db } from "@/lib/db";
import {
  isoDate,
  layoutWeek,
  parseAnchor,
  type Block,
} from "@/lib/calendar/week";
import { rangeForView, shiftAnchor, monthDays, VIEWS, type ViewName } from "@/lib/calendar/views";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { QuarterGrid } from "@/components/calendar/QuarterGrid";
import { FilterSidebar } from "@/components/calendar/FilterSidebar";
import { ChatToggle } from "@/components/calendar/ChatToggle";

const VIEW_LABEL: Record<ViewName, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

function parseView(v: string | undefined): ViewName {
  return (VIEWS as string[]).includes(v ?? "") ? (v as ViewName) : "week";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; view?: string }>;
}) {
  const { w, view: viewParam } = await searchParams;
  const view = parseView(viewParam);
  const anchor = parseAnchor(w);
  const { start, end } = rangeForView(view, anchor);

  const events = await db.event.findMany({
    where: {
      AND: [{ start: { lt: end } }, { end: { gt: start } }],
      calendar: { enabled: true },
    },
    include: { calendar: { include: { account: true } } },
    orderBy: { start: "asc" },
  });

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
    { id: string; title: string; notes: string | null; calendarId: string; source: string; allDay: boolean }
  > = {};
  for (const ev of events) {
    detailsById[ev.id] = {
      id: ev.id,
      title: ev.title,
      notes: ev.notes,
      calendarId: ev.calendarId,
      source: ev.calendar.account.source,
      allDay: ev.allDay,
    };
  }

  const blocks: Block[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    color: e.calendar.color,
    calendarName: e.calendar.name,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
  }));

  const accountCount = await db.account.count();
  const projects = await db.project.findMany({
    where: { dueDate: { not: null } },
    orderBy: { dueDate: "asc" },
  });

  const prev = isoDate(shiftAnchor(view, anchor, -1));
  const next = isoDate(shiftAnchor(view, anchor, 1));
  const today = isoDate(new Date());

  const heading = (() => {
    if (view === "day") return format(anchor, "EEEE, MMM d");
    if (view === "month") return format(anchor, "MMMM yyyy");
    if (view === "quarter") return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${format(anchor, "yyyy")}`;
    // week
    const sameMonth = start.getMonth() === end.getMonth();
    return sameMonth ? format(start, "MMMM yyyy") : `${format(start, "MMM")} – ${format(end, "MMM yyyy")}`;
  })();

  return (
    <div className="h-full flex">
      <FilterSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
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
            {accountCount > 0 && (
              <form action="/api/sync/all" method="post" className="ml-2">
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
        ) : view === "day" || view === "week" ? (
          <TimeGridView
            view={view}
            anchor={anchor}
            blocks={blocks}
            calendars={calendarOptions}
            detailsById={detailsById}
          />
        ) : view === "month" ? (
          <MonthGrid
            days={monthDays(anchor).map((d) => d.toISOString())}
            blocks={blocks.map((b) => ({
              ...b,
              start: b.start.toISOString(),
              end: b.end.toISOString(),
            }))}
            monthAnchor={anchor.toISOString()}
            calendars={calendarOptions}
            detailsById={detailsById}
          />
        ) : (
          <QuarterGrid
            start={start}
            end={end}
            projects={projects
              .filter((p) => p.dueDate)
              .map((p) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                start: p.createdAt,
                due: p.dueDate as Date,
              }))}
            dueMarkers={blocks
              .filter((b) => b.allDay)
              .map((b) => ({ id: b.id, title: b.title, color: b.color, date: b.start }))}
          />
        )}
      </div>
    </div>
  );
}

function TimeGridView({
  view,
  anchor,
  blocks,
  calendars,
  detailsById,
}: {
  view: "day" | "week";
  anchor: Date;
  blocks: Block[];
  calendars: { id: string; name: string; color: string; source: string; accountLabel: string }[];
  detailsById: Record<
    string,
    { id: string; title: string; notes: string | null; calendarId: string; source: string; allDay: boolean }
  >;
}) {
  const days =
    view === "day"
      ? [anchor]
      : Array.from({ length: 7 }, (_, i) => {
          // Sunday-anchored: getDay() returns 0=Sun..6=Sat
          const d = new Date(anchor);
          const dayIdx = d.getDay();
          d.setDate(d.getDate() - dayIdx + i);
          d.setHours(0, 0, 0, 0);
          return d;
        });

  const { timed, allDay } = layoutWeek(blocks, days);
  const timedSer = timed.map((b) => ({ ...b, start: b.start.toISOString(), end: b.end.toISOString() }));
  const allDaySer = allDay.map((b) => ({ ...b, start: b.start.toISOString(), end: b.end.toISOString() }));
  const daysSer = days.map((d) => d.toISOString());

  return (
    <WeekGrid
      days={daysSer}
      timed={timedSer}
      allDay={allDaySer}
      calendars={calendars}
      detailsById={detailsById}
    />
  );
}
