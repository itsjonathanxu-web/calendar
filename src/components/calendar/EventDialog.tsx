"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { X, Trash2, ChevronDown, Check } from "lucide-react";
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
      rrule?: string | null;
      isInstance?: boolean; // is this a synthetic recurring instance?
    }
  | null;

type RepeatPreset = "none" | "daily" | "weekly" | "monthly" | "yearly";

function presetToRRule(preset: RepeatPreset, until: string | null): string | null {
  if (preset === "none") return null;
  const map: Record<Exclude<RepeatPreset, "none">, string> = {
    daily: "FREQ=DAILY",
    weekly: "FREQ=WEEKLY",
    monthly: "FREQ=MONTHLY",
    yearly: "FREQ=YEARLY",
  };
  let rule = map[preset];
  if (until) {
    const d = new Date(until + "T23:59:59");
    rule += `;UNTIL=${d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
  }
  return rule;
}

function rruleToPreset(rrule: string | null | undefined): RepeatPreset {
  if (!rrule) return "none";
  if (rrule.includes("FREQ=DAILY")) return "daily";
  if (rrule.includes("FREQ=WEEKLY")) return "weekly";
  if (rrule.includes("FREQ=MONTHLY")) return "monthly";
  if (rrule.includes("FREQ=YEARLY")) return "yearly";
  return "none";
}

function rruleUntil(rrule: string | null | undefined): string {
  if (!rrule) return "";
  const m = rrule.match(/UNTIL=(\d{8})T?(\d{6})?/);
  if (!m) return "";
  const y = m[1].slice(0, 4), mo = m[1].slice(4, 6), d = m[1].slice(6, 8);
  return `${y}-${mo}-${d}`;
}

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
  const [repeat, setRepeat] = useState<RepeatPreset>("none");
  const [until, setUntil] = useState<string>("");
  const [editScope, setEditScope] = useState<"all" | "this" | "future">("all");

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
      setRepeat("none");
      setUntil("");
      setEditScope("all");
    } else {
      setTitle(mode.title);
      setCalendarId(mode.calendarId);
      setStartStr(toLocalInput(mode.start));
      setEndStr(toLocalInput(mode.end));
      setAllDay(mode.allDay);
      setNotes(mode.notes ?? "");
      setRepeat(rruleToPreset(mode.rrule));
      setUntil(rruleUntil(mode.rrule));
      // For an instance click, default to "this only"; for a master click default to "all"
      setEditScope(mode.isInstance ? "this" : "all");
    }
    // Intentionally exclude `calendars` from deps. The parent recreates this
    // array on every render, so depending on it would re-fire this effect on
    // every parent re-render and clobber edits the user just typed (notes,
    // title, etc.) with the original mode values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (!mode) return null;

  const editable =
    mode.kind === "create" ||
    (mode.kind === "edit" &&
      (mode.source === "google" ||
        mode.source === "notion" ||
        mode.source === "notion-mcp"));

  async function save() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const start = new Date(startStr);
      const end = new Date(endStr);
      const rrule = presetToRRule(repeat, until || null);
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
            rrule,
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
            rrule,
            scope: editScope,
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
    const isRecurring = Boolean(mode.rrule || mode.isInstance);
    let scope: "all" | "this" | "future" = "all";
    if (isRecurring) {
      const ans = prompt(
        "This event repeats. Type 'this' (this one only), 'future' (this and future), or 'all' (every occurrence):",
        "this",
      );
      if (!ans) return;
      const v = ans.trim().toLowerCase();
      if (v !== "this" && v !== "future" && v !== "all") return;
      scope = v;
    } else {
      if (!confirm("Delete this event?")) return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/events/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: mode.eventId, scope }),
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
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-strong w-full max-w-md rounded-2xl shadow-2xl"
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

          {/* Repeat picker — surfaced prominently so it's clear how to make recurring events */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-[var(--color-fg-muted)]">
              Repeat
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as RepeatPreset)}
                disabled={!editable || (mode.kind === "edit" && mode.isInstance && editScope !== "all")}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
              >
                <option value="none">Doesn&apos;t repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </select>
            </label>
            {repeat !== "none" && (
              <label className="block text-xs text-[var(--color-fg-muted)]">
                Until (optional)
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  disabled={!editable}
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
                />
              </label>
            )}
          </div>

          {mode.kind === "create" && (
            <div className="space-y-1">
              <div className="text-xs text-[var(--color-fg-muted)]">Category</div>
              <CategoryPicker
                calendars={calendars}
                value={calendarId}
                onChange={setCalendarId}
              />
            </div>
          )}

          {/* Edit scope (only when editing a recurring event/instance) */}
          {mode.kind === "edit" && (mode.rrule || mode.isInstance) && (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
              <div className="text-xs text-[var(--color-fg-muted)] mb-1.5">
                Apply changes to
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                {(["this", "future", "all"] as const).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editScope"
                      value={opt}
                      checked={editScope === opt}
                      onChange={() => setEditScope(opt)}
                    />
                    <span>
                      {opt === "this"
                        ? "This event only"
                        : opt === "future"
                          ? "This and following events"
                          : "All events in the series"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
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

function CategoryPicker({
  calendars,
  value,
  onChange,
}: {
  calendars: WritableCalendar[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const sorted = [...calendars].sort((a, b) => a.name.localeCompare(b.name));
  const selected = sorted.find((c) => c.id === value) ?? sorted[0];

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg-muted)]">
        Connect a writable Google account, or add a category in the sidebar.
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm hover:bg-[var(--color-fg)]/[0.04]"
      >
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: selected?.color ?? "#7c7c7c" }}
        />
        <span className="flex-1 text-left truncate">{selected?.name ?? "Pick category"}</span>
        <ChevronDown size={14} className="text-[var(--color-fg-muted)] shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)] shadow-lg py-1">
          {sorted.map((c) => {
            const isSel = c.id === value;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-fg)]/[0.06]",
                  isSel && "bg-[var(--color-fg)]/[0.04]",
                )}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: c.color }}
                />
                <span className="flex-1 truncate">{c.name}</span>
                {isSel && <Check size={14} className="text-[var(--color-fg-muted)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
