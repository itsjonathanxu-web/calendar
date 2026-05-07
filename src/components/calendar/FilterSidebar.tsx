import { db } from "@/lib/db";

const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  notion: "Notion",
  apple: "Apple",
  "notion-mcp": "Categories",
};

// Source render order in the sidebar.
const SOURCE_ORDER = ["notion-mcp", "google", "notion", "apple"];

function calendarSortKey(c: { name: string; config: string | null }): number {
  if (!c.config) return 50;
  try {
    const parsed = JSON.parse(c.config) as { sortOrder?: number };
    return typeof parsed.sortOrder === "number" ? parsed.sortOrder : 50;
  } catch {
    return 50;
  }
}

export async function FilterSidebar() {
  const accounts = await db.account.findMany({
    orderBy: [{ source: "asc" }, { createdAt: "asc" }],
    include: { calendars: true },
  });

  if (accounts.length === 0) return null;

  // Sort accounts by SOURCE_ORDER; sort calendars within each by config.sortOrder then name.
  accounts.sort(
    (a, b) =>
      SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  for (const a of accounts) {
    a.calendars.sort(
      (x, y) => calendarSortKey(x) - calendarSortKey(y) || x.name.localeCompare(y.name),
    );
  }

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-elev)] overflow-y-auto">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Calendars
        </div>
      </div>
      <div className="p-2 space-y-3">
        {accounts.map((a) => (
          <div key={a.id}>
            <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
              {SOURCE_LABELS[a.source] ?? a.source}
              {a.source !== "notion-mcp" && ` · ${a.label}`}
            </div>
            <div className="space-y-0.5">
              {a.calendars.length === 0 && (
                <div className="px-2 py-1 text-xs text-[var(--color-fg-muted)]">
                  No calendars yet — sync.
                </div>
              )}
              {a.calendars.map((c) => (
                <form
                  key={c.id}
                  action="/api/calendars/toggle"
                  method="post"
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--color-fg)]/[0.04]"
                >
                  <input type="hidden" name="calendarId" value={c.id} />
                  <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
                  <button
                    type="submit"
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
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
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
