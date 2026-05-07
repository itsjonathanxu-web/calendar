import { Trash2 } from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { db } from "@/lib/db";

const PALETTE = [
  "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

export default async function ProjectsPage() {
  const projects = await db.project.findMany({
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  });

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          Long-term initiatives with due dates. Show up as bars on the Quarter view.
        </p>
      </header>

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <form
          action="/api/projects/create"
          method="post"
          className="p-4 grid gap-3 grid-cols-1 sm:grid-cols-[1fr_140px_120px_auto]"
        >
          <input
            name="name"
            placeholder="Project name"
            required
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
          />
          <input
            name="dueDate"
            type="date"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
          />
          <select
            name="color"
            defaultValue={PALETTE[0]}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
          >
            {PALETTE.map((c) => (
              <option key={c} value={c} style={{ backgroundColor: c, color: "white" }}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-4 py-1.5 text-sm font-medium"
          >
            Add project
          </button>
        </form>
      </section>

      <section className="space-y-2">
        {projects.length === 0 && (
          <p className="text-sm text-[var(--color-fg-muted)]">
            No projects yet. Add one above to track its deadline.
          </p>
        )}
        {projects.map((p) => {
          const due = p.dueDate;
          const days = due ? differenceInDays(due, new Date()) : null;
          const overdue = days !== null && days < 0;
          return (
            <div
              key={p.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-3 flex items-center gap-3"
            >
              <div className="w-2 h-10 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-xs text-[var(--color-fg-muted)]">
                  {due ? (
                    <>
                      Due {format(due, "PP")} · {overdue ? "overdue" : `${formatDistanceToNow(due)} away`}
                    </>
                  ) : (
                    "No due date"
                  )}
                </div>
              </div>
              <form action="/api/projects/delete" method="post">
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  aria-label="Delete project"
                  className="text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] p-1.5 rounded hover:bg-[var(--color-danger)]/[0.08]"
                >
                  <Trash2 size={14} />
                </button>
              </form>
            </div>
          );
        })}
      </section>
    </div>
  );
}
