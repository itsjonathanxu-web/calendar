"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { X, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type WritableCalendar = {
  id: string;
  name: string;
  color: string;
  source: string;
  accountLabel: string;
};

export type DialogMode =
  | { kind: "create"; start: Date; end: Date }
  | {
      kind: "edit";
      eventId: string;
      title: string;
      start: Date;
      end: Date;
      allDay: boolean;
      notes: string | null;
      calendarId: string;
      source: string;
    }
  | null;

export function EventDialog({
  mode,
  onClose,
  calendars,
}: {
  mode: DialogMode;
  onClose: () => void;
  calendars: WritableCalendar[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState<string>("");
  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!mode) return;
    setError(null);
    if (mode.kind === "create") {
      setTitle("");
      setCalendarId(calendars[0]?.id ?? "");
      setStartStr(toLocalInput(mode.start));
      setEndStr(toLocalInput(mode.end));
      setAllDay(false);
      setNotes("");
    } else {
      setTitle(mode.title);
      setCalendarId(mode.calendarId);
      setStartStr(toLocalInput(mode.start));
      setEndStr(toLocalInput(mode.end));
      setAllDay(mode.allDay);
      setNotes(mode.notes ?? "");
    }
  }, [mode, calendars]);

  if (!mode) return null;

  const editable =
    mode.kind === "create" ||
    (mode.kind === "edit" && (mode.source === "google" || mode.source === "notion"));

  async function save() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (mode.kind === "create") {
        const res = await fetch("/api/events/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            calendarId,
            title,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay,
            notes: notes || null,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "create failed");
      } else {
        const res = await fetch("/api/events/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: mode.eventId,
            title,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay,
            notes: notes || null,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "update failed");
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode?.kind !== "edit") return;
    if (!confirm("Delete this event?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/events/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: mode.eventId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "delete failed");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <div className="text-sm font-semibold">
            {mode.kind === "create" ? "New event" : "Edit event"}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-fg)]/[0.06]">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            disabled={!editable}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-[var(--color-fg-muted)]">
              Start
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                disabled={!editable}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs text-[var(--color-fg-muted)]">
              End
              <input
                type="datetime-local"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                disabled={!editable}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              disabled={!editable}
            />
            All day
          </label>

          {mode.kind === "create" && (
            <label className="block text-xs text-[var(--color-fg-muted)]">
              Calendar
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.accountLabel}
                  </option>
                ))}
                {calendars.length === 0 && (
                  <option value="">(connect a writable Google account)</option>
                )}
              </select>
            </label>
          )}

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            disabled={!editable}
            rows={3}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm resize-none"
          />

          {!editable && mode.kind === "edit" && (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {mode.source === "apple"
                ? "Apple Calendar is read-only in this app for now."
                : "This event source is read-only."}
            </p>
          )}
          {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--color-border)]">
          <div>
            {mode.kind === "edit" && editable && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="text-xs text-[var(--color-danger)] hover:underline flex items-center gap-1"
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !editable || (mode.kind === "create" && !calendarId)}
              className={cn(
                "text-xs rounded-md px-3 py-1.5 font-medium",
                editable && (mode.kind !== "create" || calendarId)
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                  : "bg-[var(--color-fg)]/[0.1] text-[var(--color-fg-muted)] cursor-not-allowed",
              )}
            >
              {busy ? "Saving…" : mode.kind === "create" ? "Create" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}
