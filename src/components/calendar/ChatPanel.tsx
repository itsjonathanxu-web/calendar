"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Send, Sparkles, Eraser, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { pushUndo } from "@/lib/undo";

type Proposal =
  | {
      type: "propose_event";
      title: string;
      start: string;
      end: string;
      calendarId?: string;
      newCategoryName?: string;
      newCategoryColor?: string;
      allDay?: boolean;
      rrule?: string;
      notes?: string;
      reasoning?: string;
    }
  | {
      type: "propose_reschedule";
      eventId: string;
      newStart: string;
      newEnd: string;
      reasoning?: string;
    }
  | {
      type: "propose_delete";
      eventId: string;
      title: string;
      reasoning?: string;
    }
  | {
      type: "propose_change_category";
      eventId: string;
      title: string;
      newCalendarId?: string;
      newCategoryName?: string;
      newCategoryColor?: string;
      newTitle?: string;
      reasoning?: string;
    };

type AppliedChange =
  | {
      kind: "created";
      title: string;
      start?: string;
      end?: string;
      allDay: boolean;
      rrule?: string;
      calendarName: string;
      calendarColor: string;
    }
  | {
      kind: "moved_time";
      title: string;
      newStart: string;
      newEnd: string;
      calendarName: string;
      calendarColor: string;
    }
  | {
      kind: "deleted";
      title: string;
      calendarName: string;
      calendarColor: string;
    }
  | {
      kind: "recategorized";
      title: string;
      fromName: string;
      fromColor: string;
      toName: string;
      toColor: string;
    }
  | {
      kind: "failed";
      action: string;
      title?: string;
      error: string;
    };

type Msg = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  applied?: AppliedChange[];
};

type CalendarMeta = { id: string; name: string; color: string; section?: string };

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const calendarsRef = useRef<Map<string, CalendarMeta>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/claude/history")
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
    refreshCalendars();
  }, [open]);

  // Push the rest of the page over so the right edge of the calendar isn't covered.
  useEffect(() => {
    if (open) document.body.classList.add("chat-open");
    else document.body.classList.remove("chat-open");
    return () => document.body.classList.remove("chat-open");
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [messages]);

  async function refreshCalendars() {
    try {
      const r = await fetch("/api/calendars/list");
      const d = await r.json();
      const map = new Map<string, CalendarMeta>();
      for (const c of d.calendars ?? []) map.set(c.id, c);
      calendarsRef.current = map;
    } catch {
      /* best-effort — chips fall back to a neutral color */
    }
  }

  function calMeta(id: string | undefined | null): CalendarMeta {
    if (!id) return { id: "", name: "Unknown", color: "#7c7c7c" };
    return calendarsRef.current.get(id) ?? { id, name: "…", color: "#7c7c7c" };
  }

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { id: "tmp-" + Date.now(), role: "user", content: text },
    ]);
    try {
      const res = await fetch("/api/claude/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "claude_failed");

      const proposals: Proposal[] = data.proposals ?? [];
      // Auto-execute every proposal — the user explicitly asked for trust-based
      // operation; ⌘Z still rolls each change back individually.
      const applied: AppliedChange[] = [];
      for (const p of proposals) {
        try {
          const change = await applyProposal(p);
          if (change) applied.push(change);
        } catch (err) {
          applied.push({
            kind: "failed",
            action: p.type,
            title:
              "title" in p ? (p as { title?: string }).title : undefined,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Refresh calendar metadata in case a new category was created.
      if (applied.some((a) => a.kind === "created" || a.kind === "recategorized")) {
        await refreshCalendars();
      }

      setMessages((m) => [
        ...m,
        {
          id: "a-" + Date.now(),
          role: "assistant",
          content: data.text ?? "",
          applied,
        },
      ]);
      router.refresh();
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: "err-" + Date.now(),
          role: "assistant",
          content: "Error: " + (err instanceof Error ? err.message : String(err)),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function applyProposal(p: Proposal): Promise<AppliedChange | null> {
    if (p.type === "propose_event") {
      // Resolve target calendar — create one on the fly if needed.
      let calendarId = p.calendarId;
      let createdCategoryId: string | null = null;
      if (!calendarId && p.newCategoryName) {
        const r = await fetch("/api/calendars/create-task-subcategory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: p.newCategoryName,
            color: p.newCategoryColor ?? "#7c7c7c",
          }),
        });
        const data = await r.json();
        if (!r.ok || !data.calendar?.id) {
          throw new Error(data.error ?? "category_create_failed");
        }
        const newCalId = String(data.calendar.id);
        calendarId = newCalId;
        createdCategoryId = newCalId;
        calendarsRef.current.set(newCalId, {
          id: newCalId,
          name: data.calendar.name ?? p.newCategoryName,
          color: data.calendar.color ?? p.newCategoryColor ?? "#7c7c7c",
        });
      }
      if (!calendarId) throw new Error("no calendarId");
      const cr = await fetch("/api/events/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calendarId,
          title: p.title,
          start: p.start,
          end: p.end,
          allDay: p.allDay,
          notes: p.notes,
          rrule: p.rrule ?? null,
        }),
      });
      const created = await cr.json().catch(() => ({}));
      if (!cr.ok) throw new Error(created.error ?? `event_create_failed (${cr.status})`);
      const newId = created.sourceId as string | undefined;

      const cal = calMeta(calendarId);
      pushUndo({
        label: `Create ${p.title}`,
        undo: async () => {
          if (newId) await postJsonOk("/api/events/delete", { id: newId });
          if (createdCategoryId) {
            await postJsonOk("/api/calendars/delete", { id: createdCategoryId });
          }
        },
        redo: async () => {
          // Best-effort redo — re-fires the original proposal but doesn't track ids beyond this turn
          await fetch("/api/events/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              calendarId,
              title: p.title,
              start: p.start,
              end: p.end,
              allDay: p.allDay,
              notes: p.notes,
              rrule: p.rrule ?? null,
            }),
          });
        },
      });

      return {
        kind: "created",
        title: p.title,
        start: p.start,
        end: p.end,
        allDay: Boolean(p.allDay),
        rrule: p.rrule,
        calendarName: cal.name,
        calendarColor: cal.color,
      };
    }

    if (p.type === "propose_reschedule") {
      // Snapshot before for undo.
      const before = await fetchEvent(p.eventId);
      const ur = await fetch("/api/events/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.eventId, start: p.newStart, end: p.newEnd }),
      });
      if (!ur.ok) throw new Error((await ur.json().catch(() => ({}))).error ?? "update_failed");
      const cal = calMeta(before?.calendarId);
      pushUndo({
        label: `Move ${before?.title ?? "event"}`,
        undo: async () => {
          if (!before) return;
          await postJsonOk("/api/events/update", {
            id: p.eventId,
            start: before.start,
            end: before.end,
          });
        },
        redo: async () => {
          await postJsonOk("/api/events/update", {
            id: p.eventId,
            start: p.newStart,
            end: p.newEnd,
          });
        },
      });
      return {
        kind: "moved_time",
        title: before?.title ?? "Event",
        newStart: p.newStart,
        newEnd: p.newEnd,
        calendarName: cal.name,
        calendarColor: cal.color,
      };
    }

    if (p.type === "propose_delete") {
      const before = await fetchEvent(p.eventId);
      const dr = await fetch("/api/events/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.eventId }),
      });
      if (!dr.ok) throw new Error((await dr.json().catch(() => ({}))).error ?? "delete_failed");
      const cal = calMeta(before?.calendarId);
      // Restore on undo only if we have the snapshot.
      pushUndo({
        label: `Delete ${before?.title ?? p.title}`,
        undo: async () => {
          if (!before) return;
          await postJsonOk("/api/events/create", {
            calendarId: before.calendarId,
            title: before.title,
            start: before.start,
            end: before.end,
            allDay: before.allDay,
            notes: before.notes,
            rrule: before.rrule ?? null,
          });
        },
        redo: async () => {
          // Redo only works if undo successfully recreated AND we knew the new id —
          // we don't, so a redo no-ops here. The user can ⌘Z again to keep deleted.
        },
      });
      return {
        kind: "deleted",
        title: before?.title ?? p.title,
        calendarName: cal.name,
        calendarColor: cal.color,
      };
    }

    if (p.type === "propose_change_category") {
      const before = await fetchEvent(p.eventId);
      let calendarId = p.newCalendarId;
      let createdCategoryId: string | null = null;
      if (!calendarId && p.newCategoryName) {
        const r = await fetch("/api/calendars/create-task-subcategory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: p.newCategoryName,
            color: p.newCategoryColor ?? "#7c7c7c",
            section: "scheduling",
          }),
        });
        const data = await r.json();
        if (!r.ok || !data.calendar?.id) throw new Error(data.error ?? "category_create_failed");
        const newCalId = String(data.calendar.id);
        calendarId = newCalId;
        createdCategoryId = newCalId;
        calendarsRef.current.set(newCalId, {
          id: newCalId,
          name: data.calendar.name ?? p.newCategoryName,
          color: data.calendar.color ?? p.newCategoryColor ?? "#7c7c7c",
        });
      }
      // Either calendar change OR rename is enough — both optional, both supported.
      if (!calendarId && !p.newTitle) throw new Error("no calendar or new title");
      const body: Record<string, unknown> = { id: p.eventId, scope: "all" };
      if (calendarId) body.calendarId = calendarId;
      if (p.newTitle) body.title = p.newTitle;
      const ur = await fetch("/api/events/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!ur.ok) throw new Error((await ur.json().catch(() => ({}))).error ?? "update_failed");
      const fromCal = calMeta(before?.calendarId);
      const toCal = calMeta(calendarId ?? before?.calendarId);
      pushUndo({
        label: `Update ${before?.title ?? p.title}`,
        undo: async () => {
          if (!before) return;
          const undoBody: Record<string, unknown> = { id: p.eventId, scope: "all" };
          if (calendarId) undoBody.calendarId = before.calendarId;
          if (p.newTitle) undoBody.title = before.title;
          await postJsonOk("/api/events/update", undoBody);
          if (createdCategoryId) {
            await postJsonOk("/api/calendars/delete", { id: createdCategoryId });
          }
        },
        redo: async () => {
          const redoBody: Record<string, unknown> = { id: p.eventId, scope: "all" };
          if (calendarId) redoBody.calendarId = calendarId;
          if (p.newTitle) redoBody.title = p.newTitle;
          await postJsonOk("/api/events/update", redoBody);
        },
      });
      return {
        kind: "recategorized",
        title: p.newTitle ?? before?.title ?? p.title,
        fromName: fromCal.name,
        fromColor: fromCal.color,
        toName: toCal.name,
        toColor: toCal.color,
      };
    }
    return null;
  }

  async function clear() {
    if (!confirm("Clear chat history?")) return;
    await fetch("/api/claude/reset", { method: "POST" });
    setMessages([]);
  }

  if (!open) return null;

  return (
    <aside className="glass-strong fixed top-0 left-0 right-0 h-[100dvh] lg:left-auto lg:bottom-0 lg:h-auto lg:w-80 z-40 flex flex-col shadow-2xl">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--color-accent)]" />
          <div className="text-sm font-semibold tracking-tight">Schedule with Claude</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clear}
            title="Clear history"
            className="p-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-fg)]/[0.06] rounded"
          >
            <Eraser size={14} />
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="p-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-fg)]/[0.06] rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <div className="text-xs text-[var(--color-fg-muted)] leading-relaxed">
            Tell me what to do — I&apos;ll just do it. ⌘Z to undo.
            <ul className="list-disc ml-4 mt-2 space-y-1">
              <li>&ldquo;Slot 2 hours of editing this week.&rdquo;</li>
              <li>&ldquo;Add a recurring Saturday 2-3pm Chinese learning in Chinese Learning.&rdquo;</li>
              <li>&ldquo;Move all Claude Course events to AI Development.&rdquo;</li>
              <li>&ldquo;Clear my schedule for the rest of today, hanging with friends.&rdquo;</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id}>
            {m.content && (
              <div
                className={cn(
                  "inline-block max-w-full rounded-2xl px-3 py-1.5 leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                    : "bg-[var(--color-fg)]/[0.06] text-[var(--color-fg)]",
                )}
              >
                {m.content}
              </div>
            )}
            {m.applied && m.applied.length > 0 && (
              <ChangesSummary changes={m.applied} />
            )}
          </div>
        ))}
        {busy && (
          <div className="text-xs text-[var(--color-fg-muted)] italic">Working…</div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="p-3 border-t border-[var(--color-border)] flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="tell me what to do…"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm flex items-center",
            input.trim() && !busy
              ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
              : "bg-[var(--color-fg)]/[0.08] text-[var(--color-fg-muted)] cursor-not-allowed",
          )}
        >
          <Send size={14} />
        </button>
      </form>
    </aside>
  );
}

function ChangesSummary({ changes }: { changes: AppliedChange[] }) {
  return (
    <div className="mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]/60 p-2 space-y-1.5">
      {changes.map((c, i) => (
        <ChangeRow key={i} c={c} />
      ))}
      <div className="text-[10px] text-[var(--color-fg-muted)] pt-1 border-t border-[var(--color-border)]/60">
        ⌘Z to undo
      </div>
    </div>
  );
}

function ChangeRow({ c }: { c: AppliedChange }) {
  if (c.kind === "failed") {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="w-2 h-2 rounded-full bg-[var(--color-danger)] mt-1.5 shrink-0" />
        <div className="flex-1">
          <span className="text-[var(--color-danger)]">Failed</span>
          {c.title && <span className="ml-1">{c.title}</span>}
          <div className="text-[10px] text-[var(--color-fg-muted)]">{c.error}</div>
        </div>
      </div>
    );
  }
  if (c.kind === "created") {
    const start = c.start ? new Date(c.start) : null;
    const end = c.end ? new Date(c.end) : null;
    return (
      <div className="flex items-start gap-2 text-xs">
        <span
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: c.calendarColor }}
        />
        <div className="flex-1 min-w-0">
          <span className="text-emerald-500">Created</span>
          <span className="ml-1 font-medium">{c.title}</span>
          <div className="text-[10px] text-[var(--color-fg-muted)] truncate">
            {start && end && (
              <>
                {c.allDay
                  ? format(start, "EEE MMM d")
                  : `${format(start, "EEE MMM d, h:mma")}–${format(end, "h:mma")}`}
                {c.rrule && " · repeats"}
                {" · "}
              </>
            )}
            <span className="text-[var(--color-fg)]/70">{c.calendarName}</span>
          </div>
        </div>
      </div>
    );
  }
  if (c.kind === "moved_time") {
    const ns = new Date(c.newStart);
    const ne = new Date(c.newEnd);
    return (
      <div className="flex items-start gap-2 text-xs">
        <span
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: c.calendarColor }}
        />
        <div className="flex-1 min-w-0">
          <span className="text-sky-400">Moved</span>
          <span className="ml-1 font-medium">{c.title}</span>
          <div className="text-[10px] text-[var(--color-fg-muted)] truncate">
            now {format(ns, "EEE MMM d, h:mma")}–{format(ne, "h:mma")} · {c.calendarName}
          </div>
        </div>
      </div>
    );
  }
  if (c.kind === "deleted") {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: c.calendarColor }}
        />
        <div className="flex-1 min-w-0">
          <span className="text-rose-500">Deleted</span>
          <span className="ml-1 font-medium">{c.title}</span>
          <div className="text-[10px] text-[var(--color-fg-muted)] truncate">
            from {c.calendarName}
          </div>
        </div>
      </div>
    );
  }
  if (c.kind === "recategorized") {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: c.toColor }}
        />
        <div className="flex-1 min-w-0">
          <span className="text-amber-400">Moved</span>
          <span className="ml-1 font-medium">{c.title}</span>
          <div className="text-[10px] text-[var(--color-fg-muted)] truncate flex items-center gap-1">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: c.fromColor }}
            />
            {c.fromName}
            <span>→</span>
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: c.toColor }}
            />
            {c.toName}
          </div>
        </div>
      </div>
    );
  }
  return null;
}

async function fetchEvent(id: string): Promise<{
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  notes: string | null;
  rrule: string | null;
  calendarId: string;
} | null> {
  try {
    const r = await fetch(`/api/events/get?id=${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return (await r.json()) as Awaited<ReturnType<typeof fetchEvent>>;
  } catch {
    return null;
  }
}

async function postJsonOk(url: string, body: unknown): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
}
