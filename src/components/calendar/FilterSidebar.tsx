import { db } from "@/lib/db";
import { AddTaskCategoryButton } from "./AddTaskCategoryButton";
import { TaskModeToggle } from "./TaskModeToggle";

const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  "notion-mcp": "Local",
};

function calendarSortKey(c: { name: string; config: string | null }): number {
  if (!c.config) return 50;
  try {
    const parsed = JSON.parse(c.config) as { sortOrder?: number };
    return typeof parsed.sortOrder === "number" ? parsed.sortOrder : 50;
  } catch {
    return 50;
  }
}

type CalRow = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  source: string;
  accountLabel: string;
  config: string | null;
};

export async function FilterSidebar() {
  const accounts = await db.account.findMany({
    include: { calendars: true },
  });

  // Flatten then partition by Calendar.section
  const all: CalRow[] = accounts.flatMap((a) =>
    a.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      enabled: c.enabled,
      source: a.source,
      accountLabel: a.label,
      config: c.config,
      section: (c as unknown as { section?: string }).section ?? "scheduling",
    })),
  );

  const scheduling = all
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.section === "scheduling")
    .sort((a, b) => calendarSortKey(a) - calendarSortKey(b) || a.name.localeCompare(b.name));
  const tasks = all
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.section === "tasks")
    .sort((a, b) => calendarSortKey(a) - calendarSortKey(b) || a.name.localeCompare(b.name));

  // Group scheduling by source/account label
  const schedulingGroups = new Map<string, CalRow[]>();
  for (const c of scheduling) {
    const key = `${c.source}|${c.accountLabel}`;
    if (!schedulingGroups.has(key)) schedulingGroups.set(key, []);
    schedulingGroups.get(key)!.push(c);
  }

  if (all.length === 0) return null;

  return (
    <aside className="filter-sidebar glass-subtle w-56 shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
      <div className="p-2 space-y-5">
        <div className="px-1">
          <TaskModeToggle />
        </div>
        <Section title="Scheduling">
          {Array.from(schedulingGroups.entries()).map(([key, cals]) => {
            const [source, label] = key.split("|");
            return (
              <div key={key} className="space-y-0.5">
                <div className="px-2 pb-0.5 pt-1 text-[9px] uppercase tracking-wider text-[var(--color-fg-muted)]/70">
                  {SOURCE_LABELS[source] ?? source} · {label}
                </div>
                {cals.map((c) => (
                  <CalendarToggle key={c.id} c={c} />
                ))}
              </div>
            );
          })}
          {scheduling.length === 0 && (
            <div className="px-2 py-1 text-xs text-[var(--color-fg-muted)]">
              No synced calendars yet.
            </div>
          )}
        </Section>

        <Section
          title="Tasks"
          right={<AddTaskCategoryButton />}
        >
          {tasks.length === 0 && (
            <div className="px-2 py-1 text-xs text-[var(--color-fg-muted)]">
              No task categories yet.
            </div>
          )}
          {tasks.map((c) => (
            <CalendarToggle key={c.id} c={c} />
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-2 pb-1.5 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
          {title}
        </div>
        {right}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function CalendarToggle({ c }: { c: CalRow }) {
  return (
    <form
      action="/api/calendars/toggle"
      method="post"
      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--color-fg)]/[0.04]"
    >
      <input type="hidden" name="calendarId" value={c.id} />
      <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
      <button type="submit" className="flex items-center gap-2 flex-1 min-w-0 text-left">
        <span
          className={
            "w-3 h-3 rounded-[3px] shrink-0 border " +
            (c.enabled ? "border-transparent" : "border-[var(--color-border)] bg-transparent")
          }
          style={c.enabled ? { backgroundColor: c.color } : { borderColor: c.color }}
        />
        <span
          className={
            "text-sm truncate " +
            (c.enabled ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)] line-through")
          }
        >
          {c.name}
        </span>
      </button>
    </form>
  );
}
