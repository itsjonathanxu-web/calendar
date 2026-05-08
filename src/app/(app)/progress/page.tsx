import { startOfWeek, endOfWeek, startOfDay, endOfDay, addDays, format } from "date-fns";
import { db } from "@/lib/db";
import { ProgressEditor } from "./ProgressEditor";
import { TodayPanel, type TodayItem } from "./TodayPanel";

// Marker stored in Calendar.config so the rest of the app can recognize the
// hidden "Just for today" calendar. Events here only render in the Today
// panel, never on the calendar grids.
export const DAY_ONLY_MARKER = "dayOnly";

const WEEK_OPTS = { weekStartsOn: 0 as const };

type Goal = {
  id: string;
  name: string;
  color: string;
  mode: string;
  target: number;
  matchCalendars: string | null;
  matchTitles: string | null;
};

type EventRow = {
  id: string;
  start: Date;
  end: Date;
  title: string;
  calendarId: string;
  allDay: boolean;
};

function matchesGoal(ev: EventRow, goal: Goal): boolean {
  const cals = goal.matchCalendars?.split(",").filter(Boolean) ?? [];
  if (cals.length > 0 && !cals.includes(ev.calendarId)) {
    // Calendar filter set but didn't match; need title to also match if also set,
    // otherwise this event is excluded entirely.
    if (!goal.matchTitles) return false;
  } else if (cals.length > 0) {
    return true; // calendar matched and that's enough
  }
  const titles = goal.matchTitles?.split(",").filter(Boolean) ?? [];
  if (titles.length > 0) {
    const lower = ev.title.toLowerCase();
    return titles.some((t) => lower.includes(t.toLowerCase()));
  }
  return false;
}

function progressFor(goal: Goal, events: EventRow[], days: Date[]) {
  const matched = events.filter((e) => matchesGoal(e, goal));
  if (goal.mode === "hours") {
    const totalMs = matched.reduce((sum, e) => sum + (e.end.getTime() - e.start.getTime()), 0);
    const hours = totalMs / 3600_000;
    return { value: hours, label: `${hours.toFixed(1)} / ${goal.target} hr` };
  }
  if (goal.mode === "daily") {
    const daysWithMatch = days.filter((d) =>
      matched.some((e) => e.start.toDateString() === d.toDateString()),
    ).length;
    const target = goal.target > 0 ? goal.target : days.length;
    return { value: daysWithMatch, label: `${daysWithMatch} / ${target} days` };
  }
  // count
  return { value: matched.length, label: `${matched.length} / ${goal.target}` };
}

export default async function ProgressPage() {
  const now = new Date();
  const start = startOfWeek(now, WEEK_OPTS);
  const end = endOfWeek(now, WEEK_OPTS);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const [goals, events, calendars, todayEvents] = await Promise.all([
    db.progressGoal.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }) as unknown as Promise<Goal[]>,
    db.event.findMany({
      where: {
        AND: [{ start: { lt: end } }, { end: { gt: start } }],
        calendar: { enabled: true },
      },
      select: { id: true, start: true, end: true, title: true, calendarId: true, allDay: true },
    }),
    db.calendar.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    db.event.findMany({
      where: {
        AND: [{ start: { lt: todayEnd } }, { end: { gt: todayStart } }],
        calendar: { enabled: true, NOT: { name: "✓ Completed" } },
      },
      include: { calendar: { select: { name: true, color: true, section: true, config: true } } },
      orderBy: [{ allDay: "desc" }, { start: "asc" }],
    }),
  ]);

  // Auto-create the hidden "Just for today" calendar on first visit so the
  // quick-add input has somewhere to land.
  let dayOnlyCal = await db.calendar.findFirst({
    where: { config: { contains: DAY_ONLY_MARKER } },
  });
  if (!dayOnlyCal) {
    const acct = await db.account.upsert({
      where: { source_label: { source: "notion-mcp", label: "Day Notes" } },
      create: {
        source: "notion-mcp",
        label: "Day Notes",
        credentials: "{}",
        lastSyncAt: new Date(),
      },
      update: {},
    });
    dayOnlyCal = await db.calendar.create({
      data: {
        accountId: acct.id,
        sourceId: "day-notes",
        name: "Just for today",
        color: "#a3a3a3",
        enabled: true,
        section: "tasks",
        config: JSON.stringify({ sortOrder: 999, [DAY_ONLY_MARKER]: true }),
      },
    });
  }

  function isDayOnly(c: { config: string | null }): boolean {
    if (!c.config) return false;
    try {
      const parsed = JSON.parse(c.config) as Record<string, unknown>;
      return Boolean(parsed[DAY_ONLY_MARKER]);
    } catch {
      return false;
    }
  }

  // Split today into day-only notes, tasks (section=tasks), and schedule.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayDayOnly = todayEvents.filter((e: any) => isDayOnly(e.calendar));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayTasks = todayEvents.filter((e: any) => !isDayOnly(e.calendar) && e.calendar.section === "tasks");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todaySchedule = todayEvents.filter((e: any) => !isDayOnly(e.calendar) && e.calendar.section !== "tasks");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toItem = (e: any): TodayItem => ({
    id: e.id,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    title: e.title,
    notes: e.notes,
    allDay: e.allDay,
    calendarId: e.calendarId,
    calendar: {
      name: e.calendar.name,
      color: e.calendar.color,
      section: e.calendar.section ?? "scheduling",
    },
  });

  return (
    <div className="p-6 max-w-7xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Progress</h1>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          {format(now, "EEEE, MMM d")} · week of {format(start, "MMM d")}–{format(end, "MMM d")}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TodayPanel
          schedule={todaySchedule.map(toItem)}
          tasks={todayTasks.map(toItem)}
          dayOnly={todayDayOnly.map(toItem)}
          dayOnlyCalendar={
            dayOnlyCal ? { id: dayOnlyCal.id, color: dayOnlyCal.color } : null
          }
        />


        {/* RIGHT — Weekly progress goals */}
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
            This week
          </h2>

          {goals.length === 0 && (
            <div className="rounded-xl border border-[var(--color-border)] glass-subtle px-4 py-8 text-center text-sm text-[var(--color-fg-muted)]">
              No goals yet. Add one below.
            </div>
          )}
          {goals.map((g) => {
            const { value, label } = progressFor(g, events, days);
            const target = g.mode === "daily" ? (g.target > 0 ? g.target : 7) : g.target;
            const pct = Math.min(100, Math.round((value / target) * 100));
            const dayCounts = days.map((d) =>
              events.filter(
                (e) => matchesGoal(e, g) && e.start.toDateString() === d.toDateString(),
              ).length,
            );
            const max = Math.max(1, ...dayCounts);
            return (
              <div key={g.id} className="glass rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    <div className="text-sm font-medium truncate">{g.name}</div>
                  </div>
                  <div className="text-xs text-[var(--color-fg-muted)]">{label}</div>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: g.color }}
                  />
                </div>
                <div className="grid grid-cols-7 gap-1 pt-1">
                  {days.map((d, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className="h-10 w-full bg-white/3 rounded-md flex items-end overflow-hidden">
                        <div
                          className="w-full rounded-md transition-all"
                          style={{
                            height: dayCounts[i] === 0 ? "0%" : `${(dayCounts[i] / max) * 100}%`,
                            backgroundColor: dayCounts[i] === 0 ? "transparent" : g.color,
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-[var(--color-fg-muted)]">
                        {format(d, "EEE")[0]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      <ProgressEditor goals={goals} calendars={calendars} />
    </div>
  );
}

function formatRange(start: Date, end: Date): string {
  const s = format(start, start.getMinutes() === 0 ? "h" : "h:mm");
  const e = format(end, end.getMinutes() === 0 ? "h a" : "h:mm a");
  const sP = start.getHours() >= 12 ? "PM" : "AM";
  const eP = end.getHours() >= 12 ? "PM" : "AM";
  if (sP === eP) return `${s}–${e}`;
  return `${format(start, start.getMinutes() === 0 ? "h a" : "h:mm a")}–${e}`;
}
