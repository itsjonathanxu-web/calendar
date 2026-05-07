"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";

export type ReminderRow = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  rrule: string | null;
  enabled: boolean;
  lastFiredAt: string | null;
};

export function RemindersCRUD({ initial }: { initial: ReminderRow[] }) {
  const router = useRouter();
  const [reminders, setReminders] = useState(initial);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!title.trim() || !dueAt) return;
    setBusy(true);
    try {
      const res = await fetch("/api/reminders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          dueAt: new Date(dueAt).toISOString(),
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "create_failed");
      setReminders((r) => [...r, data.reminder]);
      setTitle("");
      setNotes("");
      setDueAt("");
      router.refresh();
    } catch (err) {
      alert("Failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this reminder?")) return;
    await fetch("/api/reminders/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setReminders((r) => r.filter((x) => x.id !== id));
    router.refresh();
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch("/api/reminders/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    setReminders((r) => r.map((x) => (x.id === id ? { ...x, enabled } : x)));
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Reminders</h2>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          One-shot notifications independent of any calendar event. Fires across all subscribed devices.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 grid grid-cols-1 sm:grid-cols-[1fr_220px_auto] gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Take vitamins"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
        />
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !title.trim() || !dueAt}
          className="text-xs rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-1.5 font-medium disabled:opacity-50"
        >
          Add reminder
        </button>
      </div>

      {reminders.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-muted)]">
          No reminders yet. Add one above to get a notification at a specific time.
        </p>
      ) : (
        <ul className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] divide-y divide-[var(--color-border)]">
          {reminders.map((r) => {
            const due = new Date(r.dueAt);
            const past = due < new Date() && r.lastFiredAt !== null;
            return (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                />
                <div className="flex-1 min-w-0">
                  <div className={"text-sm " + (r.enabled ? "" : "text-[var(--color-fg-muted)] line-through")}>
                    {r.title}
                  </div>
                  <div className="text-xs text-[var(--color-fg-muted)]">
                    {format(due, "EEE MMM d, h:mm a")}
                    {past && " · fired"}
                  </div>
                </div>
                <button
                  onClick={() => remove(r.id)}
                  className="text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] p-1.5 rounded hover:bg-[var(--color-danger)]/[0.08]"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
