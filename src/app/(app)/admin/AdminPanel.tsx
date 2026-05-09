"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import {
  reseedTasks,
  reseedProgress,
  migrateAppleMayToLocal,
  disconnectAppleEntirely,
  runBackupNow,
  deleteTaskCategory,
} from "./actions";

type Account = { id: string; source: string; label: string; lastSyncAt: string | null };
type TaskCal = { id: string; name: string; color: string; eventCount: number; sourceId: string };

export function AdminPanel({
  accounts,
  taskCalendars,
  remindersEnabled,
}: {
  accounts: Account[];
  taskCalendars: TaskCal[];
  remindersEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  function run(id: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setPendingId(id);
    start(async () => {
      try {
        const r = await fn();
        setFeedback(r);
        router.refresh();
      } catch (err) {
        setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) });
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <>
      {feedback && (
        <div
          className={
            "rounded-xl px-3 py-2 text-sm glass-subtle border " +
            (feedback.ok
              ? "border-emerald-400/30 text-emerald-300"
              : "border-[var(--color-danger)]/40 text-[var(--color-danger)]")
          }
        >
          {feedback.ok ? "✓ " : "✗ "}
          {feedback.message}
        </div>
      )}

      <Section title="Tasks">
        <Action
          label="Reseed tasks from snapshot"
          desc="Re-imports the 36 tasks pulled from your Notion DB on May 7. Idempotent — existing tasks are updated, not duplicated."
          busy={pending && pendingId === "reseed-tasks"}
          onRun={() => run("reseed-tasks", reseedTasks)}
        />
        {taskCalendars.length > 0 && (
          <div className="space-y-1 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] px-1">
              Task categories
            </div>
            {taskCalendars.map((c) => {
              const isBuiltIn = c.sourceId === "tasks" || c.sourceId === "completed";
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md glass-subtle"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-sm flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-[var(--color-fg-muted)] tabular-nums">
                    {c.eventCount}
                  </span>
                  {!isBuiltIn && (
                    <button
                      onClick={() => {
                        if (!confirm(`Delete "${c.name}" and its ${c.eventCount} events?`)) return;
                        run(`del-${c.id}`, () => deleteTaskCategory(c.id));
                      }}
                      disabled={pending && pendingId === `del-${c.id}`}
                      className="text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] p-1 rounded"
                      title="Delete category"
                    >
                      {pending && pendingId === `del-${c.id}` ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Progress">
        <Action
          label="Reseed Fitness / SHAI / Stretching goals"
          desc="Creates the three preset goals if they don't already exist."
          busy={pending && pendingId === "reseed-progress"}
          onRun={() => run("reseed-progress", reseedProgress)}
        />
      </Section>

      <Section title="Sync">
        {accounts.length === 0 ? (
          <div className="text-sm text-[var(--color-fg-muted)] px-1">
            No sources connected. Add Google in Settings.
          </div>
        ) : (
          <div className="space-y-1">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md glass-subtle text-sm"
              >
                <span className="text-[var(--color-fg-muted)] w-20 text-xs uppercase tracking-wider">
                  {a.source}
                </span>
                <span className="flex-1 truncate">{a.label}</span>
                <span className="text-xs text-[var(--color-fg-muted)]">
                  {a.lastSyncAt
                    ? `synced ${new Date(a.lastSyncAt).toLocaleString()}`
                    : "not synced"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {accounts.some((a) => a.source === "apple") && (
        <Section title="Apple migration">
          <Action
            label="Mirror May 2026 Apple events into local"
            desc="Copies every Apple-sourced event between May 1–31 2026 into a local 'Migrated from Apple' account, mirroring your iCloud calendars (name + color). Idempotent. Run this BEFORE disconnecting."
            busy={pending && pendingId === "migrate-may"}
            onRun={() => run("migrate-may", migrateAppleMayToLocal)}
          />
          <Action
            label="Disconnect Apple entirely"
            desc="Removes every Apple account, calendar, and synced event row from this app. Local mirrors stay. iCloud itself is untouched. Run this AFTER you've confirmed May looks right in the calendar view."
            busy={pending && pendingId === "disconnect-apple"}
            onRun={() => run("disconnect-apple", disconnectAppleEntirely)}
            variant="danger"
          />
        </Section>
      )}

      <Section title="Backup">
        <Action
          label="Snapshot DB now"
          desc="Copies dev.db to /app/data/backups/. Daily snapshots run automatically; this is a manual override."
          busy={pending && pendingId === "backup"}
          onRun={() => run("backup", runBackupNow)}
        />
      </Section>

      <Section title="Reminders">
        <div className="text-sm text-[var(--color-fg-muted)] px-1">
          Cron is {remindersEnabled ? "running" : "paused"}. Toggle in Settings.
        </div>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 pt-2">
      <h2 className="text-xs uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Action({
  label,
  desc,
  busy,
  onRun,
  variant = "default",
}: {
  label: string;
  desc: string;
  busy: boolean;
  onRun: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <div className="glass rounded-xl px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">{desc}</div>
      </div>
      <button
        onClick={onRun}
        disabled={busy}
        className={
          "shrink-0 text-xs rounded-md px-3 py-1.5 font-medium border " +
          (variant === "danger"
            ? "border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/[0.08]"
            : "border-white/30 hover:bg-white/[0.08]") +
          " disabled:opacity-50"
        }
      >
        {busy ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Working
          </span>
        ) : variant === "danger" ? (
          "Run"
        ) : (
          "Run"
        )}
      </button>
    </div>
  );
}
