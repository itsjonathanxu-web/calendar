"use client";

import { AddTaskCategoryButton } from "./AddTaskCategoryButton";
import { TaskModeToggle } from "./TaskModeToggle";
import { useDeviceFilter } from "@/lib/use-device-filter";

const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  "notion-mcp": "Local",
};

type CalRow = {
  id: string;
  name: string;
  color: string;
  section: string;
  source: string;
  accountLabel: string;
  sortKey: number;
};

export function FilterControls({
  calendars,
  initialDisabled,
}: {
  calendars: CalRow[];
  initialDisabled: string[];
}) {
  const { isEnabled, toggle } = useDeviceFilter(initialDisabled);

  const scheduling = calendars
    .filter((c) => c.section === "scheduling")
    .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name));
  const tasks = calendars
    .filter((c) => c.section === "tasks")
    .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name));

  const schedulingGroups = new Map<string, CalRow[]>();
  for (const c of scheduling) {
    const key = `${c.source}|${c.accountLabel}`;
    if (!schedulingGroups.has(key)) schedulingGroups.set(key, []);
    schedulingGroups.get(key)!.push(c);
  }

  return (
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
                <CalendarToggle
                  key={c.id}
                  c={c}
                  enabled={isEnabled(c.id)}
                  onToggle={() => toggle(c.id)}
                />
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

      <Section title="Tasks" right={<AddTaskCategoryButton />}>
        {tasks.length === 0 && (
          <div className="px-2 py-1 text-xs text-[var(--color-fg-muted)]">
            No task categories yet.
          </div>
        )}
        {tasks.map((c) => (
          <CalendarToggle
            key={c.id}
            c={c}
            enabled={isEnabled(c.id)}
            onToggle={() => toggle(c.id)}
          />
        ))}
      </Section>
    </div>
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

function CalendarToggle({
  c,
  enabled,
  onToggle,
}: {
  c: CalRow;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--color-fg)]/[0.04] text-left"
    >
      <span
        className={
          "w-3 h-3 rounded-[3px] shrink-0 border " +
          (enabled ? "border-transparent" : "border-[var(--color-border)] bg-transparent")
        }
        style={enabled ? { backgroundColor: c.color } : { borderColor: c.color }}
      />
      <span
        className={
          "text-sm truncate flex-1 min-w-0 " +
          (enabled ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)] line-through")
        }
      >
        {c.name}
      </span>
    </button>
  );
}
