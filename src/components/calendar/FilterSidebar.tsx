import { db } from "@/lib/db";
import { FilterControls } from "./FilterControls";

function calendarSortKey(config: string | null): number {
  if (!config) return 50;
  try {
    const parsed = JSON.parse(config) as { sortOrder?: number };
    return typeof parsed.sortOrder === "number" ? parsed.sortOrder : 50;
  } catch {
    return 50;
  }
}

export async function FilterSidebar() {
  const accounts = await db.account.findMany({
    include: { calendars: true },
  });

  const flat = accounts
    .flatMap((a) =>
      a.calendars.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        section: (c as unknown as { section?: string }).section ?? "scheduling",
        source: a.source,
        accountLabel: a.label,
        sortKey: calendarSortKey(c.config),
        enabled: c.enabled,
        config: c.config,
      })),
    )
    // Hide the "Just for today" calendar — it's surfaced only in the Progress
    // page's Today panel.
    .filter((c) => !(c.config && c.config.includes('"dayOnly":true')))
    .map(({ config: _config, ...rest }) => rest);

  if (flat.length === 0) return null;

  // Calendars currently disabled in DB seed first-time per-device state so
  // existing toggles aren't lost when this device switches to client-only filters.
  const initialDisabled = flat.filter((c) => !c.enabled).map((c) => c.id);
  const calendars = flat.map(({ enabled: _enabled, ...rest }) => rest);

  return (
    <aside className="filter-sidebar glass-subtle w-56 shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
      <FilterControls calendars={calendars} initialDisabled={initialDisabled} />
    </aside>
  );
}
