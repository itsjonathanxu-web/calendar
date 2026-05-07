import { startOfWeek, endOfWeek, addDays, format } from "date-fns";
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

  const [goals, events, calendars] = await Promise.all([
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
  ]);

  return (
    <div className="p-6 max-w-5xl space-y-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Progress</h1>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          Weekly schedule-based goals · {format(start, "MMM d")}–{format(end, "MMM d")}
        </p>
      </header>

      <section className="space-y-3">
        {goals.length === 0 && (
          <div className="rounded-xl border border-[var(--color-border)] glass-subtle px-4 py-8 text-center text-sm text-[var(--color-fg-muted)]">
            No goals yet. Add one below.
          </div>
        )}
        {goals.map((g) => {
          const { value, label } = progressFor(g, events, days);
          const target = g.mode === "daily" ? (g.target > 0 ? g.target : 7) : g.target;
          const pct = Math.min(100, Math.round((value / target) * 100));
          // Per-day matched count (for the gantt visualization)
          const dayCounts = days.map((d) => {
            return events.filter(
              (e) => matchesGoal(e, g) && e.start.toDateString() === d.toDateString(),
            ).length;
          });
          const max = Math.max(1, ...dayCounts);
          return (
            <div
              key={g.id}
              className="glass rounded-xl px-4 py-3 space-y-2"
            >
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

              {/* Overall bar */}
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: g.color }}
                />
              </div>

              {/* Weekly mini-gantt: 7 columns, height ∝ events on that day */}
              <div className="grid grid-cols-7 gap-1 pt-1">
                {days.map((d, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="h-12 w-full bg-white/3 rounded-md flex items-end overflow-hidden">
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

      <ProgressEditor goals={goals} calendars={calendars} />
    </div>
  );
}
