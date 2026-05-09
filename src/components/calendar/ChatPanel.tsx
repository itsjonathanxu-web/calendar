"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Send, Sparkles, Eraser, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { pushUndo } from "@/lib/undo";

// New shape: server runs the agentic loop and tells us what was actually
// done. Each entry mirrors the AppliedEntry from src/lib/scheduler/tools.ts
// (kept in lockstep — if you add a kind there, add it here too).

type EventSnapshot = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  notes: string | null;
  rrule: string | null;
  calendarId: string;
};

type AppliedEntry =
  | {
      kind: "event_created";
      eventId: string;
      title: string;
      start: string | null;
      end: string | null;
      allDay: boolean;
      rrule: string | null;
      calendarId: string;
      calendarName: string;
      calendarColor: string;
      createdCategoryId: string | null;
    }
  | {
      kind: "event_updated";
      eventId: string;
      title: string;
      calendarName: string;
      calendarColor: string;
      before: EventSnapshot;
      after: EventSnapshot;
    }
  | {
      kind: "event_deleted";
      title: string;
      calendarName: string;
      calendarColor: string;
      restore: EventSnapshot;
    }
  | {
      kind: "event_split";
      title: string;
      calendarName: string;
      calendarColor: string;
      newEventIds: string[];
      restore: EventSnapshot;
    }
  | {
      kind: "event_cloned";
      title: string;
      eventId: string;
      calendarName: string;
      calendarColor: string;
      start: string | null;
      end: string | null;
    }
  | {
      kind: "category_created";
      categoryId: string;
      name: string;
      color: string;
      section: string;
    }
  | {
      kind: "category_updated";
      categoryId: string;
      name: string;
      color: string;
      section: string;
      before: { name: string; color: string; section: string };
    }
  | {
      kind: "category_deleted";
      name: string;
      color: string;
      removedEventIds: string[];
    }
  | {
      kind: "archived_completed";
      count: number;
    }
  | {
      kind: "rule_saved";
      ruleId: string;
      text: string;
      priority: number;
    }
  | {
      kind: "working_hours_updated";
      newStart: string;
      newEnd: string;
      before: { start: string; end: string };
    };

type Msg = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  applied?: AppliedEntry[];
};

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/claude/history")
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open) document.body.classList.add("chat-open");
    else document.body.classList.remove("chat-open");
    return () => document.body.classList.remove("chat-open");
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [messages]);

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

      const applied: AppliedEntry[] = data.applied ?? [];
      // Register undo entries for each applied change so ⌘Z reverses them.
      for (const a of applied) registerUndo(a);

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
              <li>&ldquo;Add a recurring Saturday 8-10pm Chinese learning until end of May.&rdquo;</li>
              <li>&ldquo;Move all Claude Course events to AI Development.&rdquo;</li>
              <li>&ldquo;Clear my schedule for the rest of today, hanging with friends.&rdquo;</li>
              <li>&ldquo;Work was cancelled Friday — what should I pull forward?&rdquo;</li>
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

// ── Undo registration ─────────────────────────────────────────────────────
// Each applied entry pushes a closure that calls the standard session-authed
// endpoints (/api/events/*, /api/calendars/*) — no debug token needed. The
// undo system handles ⌘Z / ⌘⇧Z globally.

async function postJson(url: string, body: unknown): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
}

function registerUndo(a: AppliedEntry) {
  switch (a.kind) {
    case "event_created":
      pushUndo({
        label: `Create ${a.title}`,
        undo: async () => {
          await postJson("/api/events/delete", { id: a.eventId });
          if (a.createdCategoryId) {
            await postJson("/api/calendars/delete", { id: a.createdCategoryId });
          }
        },
        redo: async () => {
          /* skip — would need to track new ids */
        },
      });
      break;
    case "event_updated": {
      const before = a.before;
      pushUndo({
        label: `Update ${a.title}`,
        undo: async () => {
          await postJson("/api/events/update", {
            id: a.eventId,
            title: before.title,
            start: before.start,
            end: before.end,
            allDay: before.allDay,
            notes: before.notes,
            rrule: before.rrule,
            calendarId: before.calendarId,
            scope: "all",
          });
        },
        redo: async () => {
          await postJson("/api/events/update", {
            id: a.eventId,
            title: a.after.title,
            start: a.after.start,
            end: a.after.end,
            allDay: a.after.allDay,
            notes: a.after.notes,
            rrule: a.after.rrule,
            calendarId: a.after.calendarId,
            scope: "all",
          });
        },
      });
      break;
    }
    case "event_deleted": {
      const r = a.restore;
      pushUndo({
        label: `Delete ${a.title}`,
        undo: async () => {
          await postJson("/api/events/create", {
            calendarId: r.calendarId,
            title: r.title,
            start: r.start,
            end: r.end,
            allDay: r.allDay,
            notes: r.notes,
            rrule: r.rrule,
          });
        },
        redo: async () => {
          /* skip */
        },
      });
      break;
    }
    case "event_split": {
      const r = a.restore;
      pushUndo({
        label: `Split ${a.title}`,
        undo: async () => {
          await Promise.all(a.newEventIds.map((id) => postJson("/api/events/delete", { id })));
          await postJson("/api/events/create", {
            calendarId: r.calendarId,
            title: r.title,
            start: r.start,
            end: r.end,
            allDay: r.allDay,
            notes: r.notes,
            rrule: r.rrule,
          });
        },
        redo: async () => {
          /* skip */
        },
      });
      break;
    }
    case "event_cloned":
      pushUndo({
        label: `Clone ${a.title}`,
        undo: async () => {
          await postJson("/api/events/delete", { id: a.eventId });
        },
        redo: async () => {
          /* skip */
        },
      });
      break;
    case "category_created":
      pushUndo({
        label: `Create category ${a.name}`,
        undo: async () => {
          await postJson("/api/calendars/delete", { id: a.categoryId });
        },
        redo: async () => {
          /* skip */
        },
      });
      break;
    case "category_updated": {
      const b = a.before;
      pushUndo({
        label: `Update category ${a.name}`,
        undo: async () => {
          await postJson("/api/calendars/update", {
            id: a.categoryId,
            name: b.name,
            color: b.color,
            section: b.section,
          });
        },
        redo: async () => {
          await postJson("/api/calendars/update", {
            id: a.categoryId,
            name: a.name,
            color: a.color,
            section: a.section,
          });
        },
      });
      break;
    }
    case "category_deleted":
      // Hard to undo cleanly (we'd need the calendar id + every event id);
      // skip and warn via initial summary.
      break;
    case "rule_saved":
      pushUndo({
        label: `Save rule "${a.text}"`,
        undo: async () => {
          await fetch("/api/rules/delete", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ id: a.ruleId }),
          });
        },
        redo: async () => {
          /* skip */
        },
      });
      break;
    case "working_hours_updated":
      pushUndo({
        label: `Update working hours`,
        undo: async () => {
          await fetch("/api/settings/working-hours", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              workdayStart: a.before.start,
              workdayEnd: a.before.end,
            }),
          });
        },
        redo: async () => {
          await fetch("/api/settings/working-hours", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              workdayStart: a.newStart,
              workdayEnd: a.newEnd,
            }),
          });
        },
      });
      break;
    case "archived_completed":
      /* archive is a query against existing state; nothing to undo */
      break;
  }
}

// ── Summary rendering ─────────────────────────────────────────────────────

function ChangesSummary({ changes }: { changes: AppliedEntry[] }) {
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

function ChangeRow({ c }: { c: AppliedEntry }) {
  switch (c.kind) {
    case "event_created": {
      const start = c.start ? new Date(c.start) : null;
      const end = c.end ? new Date(c.end) : null;
      return (
        <Row dotColor={c.calendarColor} verb="Created" verbColor="text-emerald-500" title={c.title}>
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
        </Row>
      );
    }
    case "event_updated": {
      const titleChanged = c.before.title !== c.after.title;
      const calChanged = c.before.calendarId !== c.after.calendarId;
      const timeChanged =
        c.before.start !== c.after.start || c.before.end !== c.after.end;
      const verb = titleChanged
        ? "Renamed"
        : calChanged
          ? "Moved"
          : timeChanged
            ? "Rescheduled"
            : "Updated";
      const ns = new Date(c.after.start);
      const ne = new Date(c.after.end);
      return (
        <Row
          dotColor={c.calendarColor}
          verb={verb}
          verbColor={calChanged ? "text-amber-400" : timeChanged ? "text-sky-400" : "text-zinc-300"}
          title={c.after.title}
        >
          {titleChanged && <>was &ldquo;{c.before.title}&rdquo; · </>}
          {timeChanged && (
            <>
              {format(ns, "EEE MMM d, h:mma")}–{format(ne, "h:mma")}
              {" · "}
            </>
          )}
          <span className="text-[var(--color-fg)]/70">{c.calendarName}</span>
        </Row>
      );
    }
    case "event_deleted":
      return (
        <Row dotColor={c.calendarColor} verb="Deleted" verbColor="text-rose-500" title={c.title}>
          from {c.calendarName}
        </Row>
      );
    case "event_split":
      return (
        <Row dotColor={c.calendarColor} verb="Split" verbColor="text-violet-400" title={c.title}>
          into {c.newEventIds.length} pieces · {c.calendarName}
        </Row>
      );
    case "event_cloned": {
      const ns = c.start ? new Date(c.start) : null;
      return (
        <Row dotColor={c.calendarColor} verb="Cloned" verbColor="text-cyan-400" title={c.title}>
          {ns && <>at {format(ns, "EEE MMM d, h:mma")} · </>}
          {c.calendarName}
        </Row>
      );
    }
    case "category_created":
      return (
        <Row dotColor={c.color} verb="New category" verbColor="text-emerald-500" title={c.name}>
          section {c.section}
        </Row>
      );
    case "category_updated":
      return (
        <Row dotColor={c.color} verb="Updated category" verbColor="text-amber-400" title={c.name}>
          {c.before.name !== c.name && <>was &ldquo;{c.before.name}&rdquo;</>}
        </Row>
      );
    case "category_deleted":
      return (
        <Row dotColor={c.color} verb="Deleted category" verbColor="text-rose-500" title={c.name}>
          {c.removedEventIds.length} events removed
        </Row>
      );
    case "archived_completed":
      return (
        <Row dotColor="#7c7c7c" verb="Archived" verbColor="text-zinc-300" title="Completed tasks">
          {c.count} in ✓ Completed
        </Row>
      );
    case "rule_saved":
      return (
        <Row dotColor="#7c7c7c" verb="Saved rule" verbColor="text-emerald-500" title={c.text}>
          priority {c.priority}
        </Row>
      );
    case "working_hours_updated":
      return (
        <Row dotColor="#7c7c7c" verb="Working hours" verbColor="text-amber-400" title={`${c.newStart}–${c.newEnd}`}>
          was {c.before.start}–{c.before.end}
        </Row>
      );
  }
}

function Row({
  dotColor,
  verb,
  verbColor,
  title,
  children,
}: {
  dotColor: string;
  verb: string;
  verbColor: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span
        className="w-2 h-2 rounded-full mt-1.5 shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <div className="flex-1 min-w-0">
        <span className={verbColor}>{verb}</span>
        <span className="ml-1 font-medium">{title}</span>
        {children && (
          <div className="text-[10px] text-[var(--color-fg-muted)] truncate">{children}</div>
        )}
      </div>
    </div>
  );
}
