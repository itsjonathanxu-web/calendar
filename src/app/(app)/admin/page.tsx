import { formatDistanceToNow } from "date-fns";
import { db } from "@/lib/db";
import { AdminPanel } from "./AdminPanel";

export default async function AdminPage() {
  const [
    accounts,
    calendars,
    eventCount,
    taskCount,
    completedCount,
    goalCount,
    pushCount,
    backupRun,
    cronRun,
    settings,
  ] = await Promise.all([
    db.account.findMany({ orderBy: { createdAt: "asc" } }),
    db.calendar.findMany({
      where: { section: "tasks" },
      orderBy: { name: "asc" },
      include: { _count: { select: { events: true } } },
    }),
    db.event.count(),
    db.event.count({ where: { calendar: { section: "tasks" } } }),
    db.event.count({ where: { calendar: { name: "✓ Completed" } } }),
    db.progressGoal.count(),
    db.pushSubscription.count(),
    db.jobRun.findUnique({ where: { kind: "backup" } }),
    db.jobRun.findUnique({ where: { kind: "reminders" } }),
    db.settings.findUnique({ where: { id: "settings" } }),
  ]);

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          One-click maintenance. No tokens, no URLs.
        </p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Connected sources" value={accounts.length} />
        <Stat label="Events" value={eventCount} />
        <Stat label="Open tasks" value={taskCount - completedCount} />
        <Stat label="Completed" value={completedCount} />
        <Stat label="Goals" value={goalCount} />
        <Stat label="Push devices" value={pushCount} />
        <Stat
          label="Last backup"
          value={backupRun ? formatDistanceToNow(backupRun.lastRunAt, { addSuffix: true }) : "never"}
        />
        <Stat
          label="Last cron tick"
          value={cronRun ? formatDistanceToNow(cronRun.lastRunAt, { addSuffix: true }) : "never"}
        />
      </section>

      {(backupRun?.lastError || cronRun?.lastError) && (
        <section className="rounded-xl border border-[var(--color-danger)]/40 glass-subtle p-3 text-xs space-y-1">
          {backupRun?.lastError && <div>Backup error: {backupRun.lastError}</div>}
          {cronRun?.lastError && <div>Cron error: {cronRun.lastError}</div>}
        </section>
      )}

      <AdminPanel
        accounts={accounts.map((a) => ({
          id: a.id,
          source: a.source,
          label: a.label,
          lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
        }))}
        taskCalendars={calendars.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          eventCount: c._count.events,
          sourceId: c.sourceId,
        }))}
        remindersEnabled={settings?.remindersEnabled ?? true}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass rounded-xl px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
        {label}
      </div>
      <div className="text-lg font-semibold mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}
