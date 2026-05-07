import { differenceInDays, format, isWithinInterval, startOfDay } from "date-fns";
import { cn } from "@/lib/cn";

type ProjectBar = {
  id: string;
  name: string;
  color: string;
  start: Date;
  due: Date;
};

type DueMarker = {
  id: string;
  title: string;
  color: string;
  date: Date;
};

export function QuarterGrid({
  start,
  end,
  projects,
  dueMarkers,
}: {
  start: Date;
  end: Date;
  projects: ProjectBar[];
  dueMarkers: DueMarker[];
}) {
  const totalDays = differenceInDays(end, start) + 1;

  // Build month tick positions
  const monthTicks: { label: string; offsetPct: number }[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const offsetDays = differenceInDays(cursor, start);
    monthTicks.push({
      label: format(cursor, "MMM"),
      offsetPct: (offsetDays / totalDays) * 100,
    });
    // step to first day of next month
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const today = new Date();
  const todayPct =
    isWithinInterval(today, { start, end })
      ? (differenceInDays(today, start) / totalDays) * 100
      : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header with month ticks */}
      <div className="relative h-9 border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        {monthTicks.map((t, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-[var(--color-border)] pl-2 flex items-center text-xs text-[var(--color-fg-muted)]"
            style={{ left: `${t.offsetPct}%` }}
          >
            {t.label}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {/* Today line */}
          {todayPct !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-[var(--color-danger)] pointer-events-none z-10"
              style={{ left: `${todayPct}%` }}
              title="Today"
            />
          )}

          {/* Project rows */}
          {projects.length === 0 && (
            <div className="px-6 py-12 text-sm text-[var(--color-fg-muted)] text-center">
              No projects yet — create one on the Projects page to see it span the timeline.
            </div>
          )}
          {projects.map((p) => {
            const startClamped = p.start < start ? start : p.start;
            const endClamped = p.due > end ? end : p.due;
            if (endClamped < start || startClamped > end) return null;
            const leftPct = (differenceInDays(startClamped, start) / totalDays) * 100;
            const widthPct =
              ((differenceInDays(endClamped, startClamped) + 1) / totalDays) * 100;
            return (
              <div key={p.id} className="relative h-9 border-b border-[var(--color-border)]">
                <div
                  className="absolute top-1.5 h-6 rounded-md text-[11px] text-white px-2 flex items-center truncate shadow-sm"
                  style={{
                    left: `${leftPct}%`,
                    width: `max(2%, ${widthPct}%)`,
                    backgroundColor: p.color,
                  }}
                  title={`${p.name}\nDue ${format(p.due, "PP")}`}
                >
                  {p.name}
                </div>
              </div>
            );
          })}

          {/* Due markers row */}
          {dueMarkers.length > 0 && (
            <div className="relative h-12 border-b border-[var(--color-border)] bg-[var(--color-fg)]/[0.02]">
              <div className="absolute left-2 top-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
                Deadlines
              </div>
              {dueMarkers.map((m) => {
                if (!isWithinInterval(m.date, { start, end })) return null;
                const offsetPct = (differenceInDays(m.date, start) / totalDays) * 100;
                return (
                  <div
                    key={m.id}
                    className="absolute top-5 -translate-x-1/2 flex flex-col items-center"
                    style={{ left: `${offsetPct}%` }}
                    title={`${m.title}\n${format(m.date, "PP")}`}
                  >
                    <div
                      className="w-2 h-2 rotate-45"
                      style={{ backgroundColor: m.color }}
                    />
                    <div className="text-[10px] text-[var(--color-fg-muted)] whitespace-nowrap mt-0.5 max-w-[80px] truncate">
                      {m.title}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
