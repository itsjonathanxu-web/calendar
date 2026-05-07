import { startOfWeek, endOfWeek, startOfDay, endOfDay, addDays, format } from "date-fns";
import { db } from "@/lib/db";
import { ProgressEditor } from "./ProgressEditor";

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
      include: { calendar: { select: { name: true, color: true, section: true } } },
      orderBy: [{ allDay: "desc" }, { start: "asc" }],
    }),
  ]);

  // Split today into tasks (section=tasks) and schedule (everything else)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayTasks = todayEvents.filter((e: any) => e.calendar.section === "tasks");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todaySchedule = todayEvents.filter((e: any) => e.calendar.section !== "tasks");

  return (
    <div className="p-6 max-w-7xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Progress</h1>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          {format(now, "EEEE, MMM d")} · week of {format(start, "MMM d")}–{format(end, "MMM d")}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Today's overview */}
        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Today</h2>

          <div className="glass rounded-xl px-4 py-3 space-y-2">
            <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
              Schedule
            </div>
            {todaySchedule.length === 0 && (
              <div className="text-sm text-[var(--color-fg-muted)] py-2">
                Nothing scheduled.
              </div>
            )}
            {todaySchedule.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm py-0.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: e.calendar.color }}
                />
                <span className="text-[var(--color-fg-muted)] tabular-nums w-20 shrink-0 text-xs">
                  {e.allDay ? "all-day" : formatRange(e.start, e.end)}
                </span>
                <span className="truncate">{e.title}</span>
              </div>
            ))}
          </div>

          <div className="glass rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
                Tasks
              </div>
              <div className="text-[10px] text-[var(--color-fg-muted)]">
                {todayTasks.length} open
              </div>
            </div>
            {todayTasks.length === 0 && (
              <div className="text-sm text-[var(--color-fg-muted)] py-2">
                No tasks for today.
              </div>
            )}
            {todayTasks.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm py-0.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: e.calendar.color }}
                />
                <span className="truncate flex-1">{e.title}</span>
                <span className="text-[10px] text-[var(--color-fg-muted)] truncate max-w-[7rem]">
                  {e.calendar.name}
                </span>
              </div>
            ))}
          </div>
        </section>

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
