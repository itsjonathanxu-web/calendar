"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, isSameDay, isSameMonth, startOfDay } from "date-fns";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Block } from "@/lib/calendar/week";
import { EventDialog, type DialogMode, type WritableCalendar } from "./EventDialog";

type SerBlock = Omit<Block, "start" | "end"> & { start: string; end: string };

type EventDetails = {
  id: string;
  title: string;
  notes: string | null;
  calendarId: string;
  calendarName?: string;
  section?: string;
  source: string;
  allDay: boolean;
  rrule?: string | null;
  isInstance?: boolean;
};

export function MonthGrid({
  days,
  blocks,
  monthAnchor,
  calendars = [],
  detailsById = {},
  taskMode = false,
}: {
  days: string[];
  blocks: SerBlock[];
  monthAnchor: string;
  calendars?: WritableCalendar[];
  detailsById?: Record<string, EventDetails>;
  taskMode?: boolean;
}) {
  // Days arrive as YYYY-MM-DD strings from the server. Parse them as local
  // midnight so day labels and "today" highlighting use the user's timezone,
  // not UTC.
  const dayDates = days.map((d) => new Date(d + "T00:00:00"));
  const monthDate = new Date(monthAnchor + "T00:00:00");
  const today = new Date();
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [overflowKey, setOverflowKey] = useState<string | null>(null);
  const router = useRouter();

  function isWritable(eventId: string): boolean {
    const det = detailsById[eventId];
    if (!det) return false;
    return det.source === "google" || det.source === "notion-mcp";
  }

  function isTask(eventId: string): boolean {
    return detailsById[eventId]?.section === "tasks";
  }

  function isCompleted(eventId: string): boolean {
    return detailsById[eventId]?.calendarName === "✓ Completed";
  }

  async function quickDelete(eventId: string) {
    if (!confirm("Delete this event?")) return;
    try {
      const res = await fetch("/api/events/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: eventId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "delete_failed");
      router.refresh();
    } catch (err) {
      alert("Could not delete: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function toggleComplete(eventId: string) {
    try {
      const res = await fetch("/api/events/toggle-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: eventId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "toggle_failed");
      router.refresh();
    } catch (err) {
      alert("Could not toggle: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // HTML5 drag — simpler than pointer events for task-mode reschedule. Only
  // active when in task mode; preserves the time-of-day, just changes the date.
  const draggingId = useRef<string | null>(null);
  const [hoverDayKey, setHoverDayKey] = useState<string | null>(null);

  async function moveTaskToDay(eventId: string, day: Date) {
    const ev = blocks.find((b) => b.id === eventId);
    if (!ev) return;
    const oldStart = new Date(ev.start);
    const oldEnd = new Date(ev.end);
    const dur = oldEnd.getTime() - oldStart.getTime();

    let newStart: Date;
    if (ev.allDay) {
      // Pin to UTC midnight of the target calendar day so the event renders
      // on that one day regardless of the viewer's timezone.
      newStart = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0));
    } else {
      newStart = new Date(day);
      newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
    }
    const newEnd = new Date(newStart.getTime() + dur);

    // Compare by calendar date in the same frame as `day` so we don't bail
    // early when the underlying timestamp differs but the displayed date doesn't.
    const oldKey = ev.allDay
      ? oldStart.toISOString().slice(0, 10)
      : `${oldStart.getFullYear()}-${oldStart.getMonth()}-${oldStart.getDate()}`;
    const newKey = ev.allDay
      ? newStart.toISOString().slice(0, 10)
      : `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    if (oldKey === newKey) return;
    try {
      await fetch("/api/events/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: eventId,
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        }),
      });
      router.refresh();
    } catch (err) {
      console.error("[MonthGrid] move task failed:", err);
    }
  }

  function blocksForDay(d: Date): SerBlock[] {
    // Compare by calendar-date string so allDay events stored at UTC midnight
    // don't accidentally appear on the previous local day (Toronto = UTC-4
    // would otherwise render midnight UTC May 7 as 8pm May 6).
    const cellKey = format(d, "yyyy-MM-dd");
    return blocks
      .filter((b) => {
        if (taskMode && detailsById[b.id]?.section !== "tasks") return false;
        const startD = new Date(b.start);
        const endD = new Date(b.end);
        if (b.allDay) {
          // Use UTC calendar date — that's the date the event was tagged with
          // regardless of viewer timezone. End is exclusive (iCal-style).
          const startKey = startD.toISOString().slice(0, 10);
          const endKey = endD.toISOString().slice(0, 10);
          // Inclusive end fallback for events stored as 23:59:59 same-day
          if (startKey === endKey) return startKey === cellKey;
          return startKey <= cellKey && endKey > cellKey;
        }
        // Timed: use local startOfDay window
        const ds = startOfDay(d);
        const dayEnd = new Date(ds.getTime() + 86400_000);
        return startD < dayEnd && endD > ds;
      })
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
  }

  function openCreate(d: Date) {
    const start = new Date(d);
    start.setHours(9, 0, 0, 0);
    const end = new Date(d);
    end.setHours(10, 0, 0, 0);
    setDialog({ kind: "create", start, end });
  }

  function openEdit(b: SerBlock) {
    const det = detailsById[b.id];
    if (!det) return;
    setDialog({
      kind: "edit",
      eventId: b.id,
      title: det.title,
      start: new Date(b.start),
      end: new Date(b.end),
      allDay: det.allDay,
      notes: det.notes,
      calendarId: det.calendarId,
      source: det.source,
      rrule: det.rrule ?? null,
      isInstance: Boolean(det.isInstance),
    });
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < dayDates.length; i += 7) weeks.push(dayDates.slice(i, i + 7));

  return (
    <div className="flex flex-col h-full">
      <div className="glass-subtle grid grid-cols-7 border-b border-[var(--color-border)]">
        {dayLabels.map((l) => (
          <div
            key={l}
            className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] text-right border-l border-[var(--color-border)] first:border-l-0"
          >
            {l}
          </div>
        ))}
      </div>
      <div
        className="flex-1 grid"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.map((wk, wi) => (
          <div
            key={wi}
            className="grid grid-cols-7 border-b border-[var(--color-border)] last:border-b-0"
          >
            {wk.map((d, di) => {
              const items = blocksForDay(d);
              const inMonth = isSameMonth(d, monthDate);
              const isToday = isSameDay(d, today);
              const cellKey = format(d, "yyyy-MM-dd");
              const showOverflow = overflowKey === cellKey;
              const visible = items.slice(0, 4);
              const hidden = items.length - visible.length;
              const isHoverTarget = taskMode && hoverDayKey === cellKey;
              return (
                <div
                  key={di}
                  onDoubleClick={() => openCreate(d)}
                  onDragOver={(e) => {
                    if (!taskMode || !draggingId.current) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (hoverDayKey !== cellKey) setHoverDayKey(cellKey);
                  }}
                  onDragLeave={() => {
                    if (hoverDayKey === cellKey) setHoverDayKey(null);
                  }}
                  onDrop={(e) => {
                    if (!taskMode) return;
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    setHoverDayKey(null);
                    draggingId.current = null;
                    if (id) moveTaskToDay(id, d);
                  }}
                  className={cn(
                    "border-l border-[var(--color-border)] first:border-l-0 px-1.5 py-1 min-h-0 overflow-visible relative group transition-colors",
                    !inMonth && "bg-[var(--color-fg)]/[0.02] text-[var(--color-fg-muted)]",
                    isHoverTarget && "bg-white/[0.06] ring-1 ring-inset ring-white/30",
                  )}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <div
                      className={cn(
                        "text-xs",
                        isToday
                          ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-medium"
                          : inMonth
                            ? "text-[var(--color-fg)]"
                            : "text-[var(--color-fg-muted)]",
                      )}
                    >
                      {format(d, "d")}
                    </div>
                    <button
                      onClick={() => openCreate(d)}
                      title="Add event"
                      aria-label="Add event"
                      className="opacity-0 group-hover:opacity-100 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] text-sm leading-none w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--color-fg)]/[0.06]"
                    >
                      +
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {visible.map((b) => {
                      const taskTile = taskMode && isTask(b.id);
                      const completed = isCompleted(b.id);
                      return (
                        <div
                          key={b.id + cellKey}
                          className="relative group/m-event"
                          draggable={taskTile}
                          onDragStart={(e) => {
                            if (!taskTile) return;
                            e.dataTransfer.setData("text/plain", b.id);
                            e.dataTransfer.effectAllowed = "move";
                            draggingId.current = b.id;
                          }}
                          onDragEnd={() => {
                            draggingId.current = null;
                            setHoverDayKey(null);
                          }}
                        >
                          <div
                            className={cn(
                              "event-tile flex items-center gap-1 w-full text-left text-[10px] leading-snug rounded-md px-1.5 py-0.5 text-white pr-4",
                              taskTile && "cursor-grab active:cursor-grabbing",
                              completed && "opacity-60",
                            )}
                            style={{ backgroundColor: muteColor(b.color) }}
                            title={`${b.title}\n${format(new Date(b.start), "p")} – ${format(new Date(b.end), "p")}`}
                          >
                            {taskTile && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleComplete(b.id);
                                }}
                                aria-label={completed ? "Uncheck" : "Mark complete"}
                                className="shrink-0 w-3 h-3 rounded-sm border border-white/50 flex items-center justify-center bg-black/20 hover:bg-black/40"
                              >
                                {completed && (
                                  <span className="text-[9px] leading-none">✓</span>
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(b)}
                              className={cn(
                                "flex-1 min-w-0 text-left truncate hover:opacity-90",
                                completed && "line-through",
                              )}
                            >
                              {b.allDay
                                ? b.title
                                : `${format(new Date(b.start), "h:mma").toLowerCase()} ${b.title}`}
                            </button>
                          </div>
                          {isWritable(b.id) && !taskTile && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                quickDelete(b.id);
                              }}
                              className="absolute right-0.5 top-0 bottom-0 my-auto h-3.5 w-3.5 opacity-0 group-hover/m-event:opacity-100 rounded text-white/90 hover:text-white hover:bg-black/30 flex items-center justify-center"
                              aria-label="Delete event"
                              title="Delete"
                            >
                              <X size={9} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {hidden > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => setOverflowKey(showOverflow ? null : cellKey)}
                          className="text-[10px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline px-1"
                        >
                          +{hidden} more
                        </button>
                        {showOverflow && (
                          <DayOverflowPopover
                            day={d}
                            items={items}
                            onClose={() => setOverflowKey(null)}
                            onPickEvent={(b) => {
                              setOverflowKey(null);
                              openEdit(b);
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <EventDialog mode={dialog} onClose={() => setDialog(null)} calendars={calendars} />
    </div>
  );
}

function DayOverflowPopover({
  day,
  items,
  onClose,
  onPickEvent,
}: {
  day: Date;
  items: SerBlock[];
  onClose: () => void;
  onPickEvent: (b: SerBlock) => void;
}) {
  return (
    <>
      {/* click-outside catcher */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="glass-strong absolute z-40 mt-1 left-0 w-64 max-h-80 overflow-y-auto rounded-xl shadow-2xl p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">{format(day, "EEEE, MMM d")}</div>
          <button
            onClick={onClose}
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] text-xs"
          >
            ✕
          </button>
        </div>
        <div className="space-y-1">
          {items.map((b) => (
            <button
              key={b.id}
              onClick={() => onPickEvent(b)}
              className="w-full text-left rounded px-2 py-1.5 hover:bg-[var(--color-fg)]/[0.06] flex items-start gap-2"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                style={{ backgroundColor: b.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{b.title}</div>
                <div className="text-[10px] text-[var(--color-fg-muted)]">
                  {b.allDay
                    ? "All day"
                    : `${format(new Date(b.start), "p")} – ${format(new Date(b.end), "p")}`}
                  <span className="ml-1">· {b.calendarName}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function muteColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "rgba(120, 120, 130, 0.55)";
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.55)`;
}
