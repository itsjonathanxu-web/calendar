"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Send, Sparkles, Eraser, X } from "lucide-react";
import { cn } from "@/lib/cn";

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
    };

type Msg = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  proposals: Proposal[];
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

  // Push the rest of the page over so the right edge of the calendar isn't covered.
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
    const tempUser: Msg = {
      id: "tmp-" + Date.now(),
      role: "user",
      content: text,
      proposals: [],
    };
    setMessages((m) => [...m, tempUser]);
    try {
      const res = await fetch("/api/claude/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "claude_failed");
      setMessages((m) => [
        ...m,
        {
          id: "a-" + Date.now(),
          role: "assistant",
          content: data.text ?? "",
          proposals: data.proposals ?? [],
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
          proposals: [],
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal(p: Proposal) {
    if (p.type === "propose_event") {
      let calendarId = p.calendarId;
      // If Claude proposed a brand-new category, create it first and route the
      // event into it.
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
        calendarId = data.calendar.id;
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
      if (!cr.ok) {
        const data = await cr.json().catch(() => ({}));
        throw new Error(data.error ?? `event_create_failed (${cr.status})`);
      }
    } else if (p.type === "propose_reschedule") {
      const ur = await fetch("/api/events/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: p.eventId,
          start: p.newStart,
          end: p.newEnd,
        }),
      });
      if (!ur.ok) {
        const data = await ur.json().catch(() => ({}));
        throw new Error(data.error ?? `event_update_failed (${ur.status})`);
      }
    } else if (p.type === "propose_delete") {
      const dr = await fetch("/api/events/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.eventId }),
      });
      if (!dr.ok) {
        const data = await dr.json().catch(() => ({}));
        throw new Error(data.error ?? `event_delete_failed (${dr.status})`);
      }
    }
    router.refresh();
    setMessages((m) => [
      ...m,
      {
        id: "ok-" + Date.now(),
        role: "assistant",
        content:
          p.type === "propose_event"
            ? `✓ Created "${p.title}".`
            : p.type === "propose_delete"
              ? `✓ Deleted "${p.title}".`
            : `✓ Moved event.`,
        proposals: [],
      },
    ]);
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
            Ask me to slot in time.
            <ul className="list-disc ml-4 mt-2 space-y-1">
              <li>&ldquo;Slot 2 hours of editing this week.&rdquo;</li>
              <li>&ldquo;Block 30 min for gym every weekday morning.&rdquo;</li>
              <li>&ldquo;From now on, no meetings before 10am.&rdquo;</li>
              <li>&ldquo;Move my Thursday call to Friday afternoon.&rdquo;</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id}>
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
            {m.proposals.length > 0 && (
              <div className="mt-2 space-y-2">
                {m.proposals.map((p, i) => (
                  <ProposalCard
                    key={`${m.id}-${i}`}
                    storageKey={`proposal-confirmed:${m.id}:${i}`}
                    p={p}
                    onConfirm={() => confirmProposal(p)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="text-xs text-[var(--color-fg-muted)] italic">Thinking…</div>
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
          placeholder="slot in 2hr deep work this week…"
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

function ProposalCard({
  p,
  onConfirm,
  storageKey,
}: {
  p: Proposal;
  onConfirm: () => Promise<void>;
  storageKey: string;
}) {
  // Persist the "confirmed" state across panel reopens / history refetches
  // so the user can't accidentally confirm the same proposal twice.
  const [done, setDone] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  function markDone() {
    setDone(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore quota / unavailable
    }
  }
  const [error, setError] = useState<string | null>(null);
  const isDelete = p.type === "propose_delete";
  const start = isDelete
    ? null
    : new Date(p.type === "propose_event" ? p.start : p.newStart);
  const end = isDelete
    ? null
    : new Date(p.type === "propose_event" ? p.end : p.newEnd);
  const heading =
    p.type === "propose_event"
      ? "Proposed event"
      : p.type === "propose_delete"
        ? "Proposed delete"
        : "Proposed move";
  const titleLine =
    p.type === "propose_event"
      ? p.title
      : p.type === "propose_delete"
        ? p.title
        : "Reschedule";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
            {heading}
          </div>
          <div className="text-sm font-medium mt-0.5">
            {titleLine}
          </div>
          {start && end && (
            <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">
              {format(start, "EEE MMM d, h:mm a")} – {format(end, "h:mm a")}
              {p.type === "propose_event" && p.rrule && (
                <span className="ml-1.5">· repeats</span>
              )}
            </div>
          )}
          {p.type === "propose_event" && p.newCategoryName && (
            <div className="text-[10px] mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-white/5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: p.newCategoryColor ?? "#7c7c7c" }}
              />
              new category: {p.newCategoryName}
            </div>
          )}
          {p.reasoning && (
            <div className="text-xs text-[var(--color-fg-muted)] mt-1.5 italic">{p.reasoning}</div>
          )}
        </div>
      </div>
      {!done ? (
        <>
          <button
            onClick={async () => {
              setError(null);
              try {
                await onConfirm();
                markDone();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            className={cn(
              "w-full text-xs rounded-md px-3 py-1.5 font-medium",
              isDelete
                ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)] border border-[var(--color-danger)]/30"
                : "bg-[var(--color-accent)] text-[var(--color-accent-fg)]",
            )}
          >
            {isDelete ? "Confirm delete" : "Confirm"}
          </button>
          {error && (
            <div className="text-xs text-[var(--color-danger)] mt-1.5">
              Couldn&apos;t save: {error}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-emerald-600">✓ Saved</div>
      )}
    </div>
  );
}
