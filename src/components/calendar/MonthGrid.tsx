"use client";

import { useState } from "react";
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
}: {
  days: string[];
  blocks: SerBlock[];
  monthAnchor: string;
  calendars?: WritableCalendar[];
  detailsById?: Record<string, EventDetails>;
}) {
  const dayDates = days.map((d) => new Date(d));
  const monthDate = new Date(monthAnchor);
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

  function blocksForDay(d: Date): SerBlock[] {
    const ds = startOfDay(d);
    return blocks
      .filter((b) => {
        const bs = startOfDay(new Date(b.start));
        const be = startOfDay(new Date(b.end));
        return bs <= ds && be >= ds;
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
      <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]">
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
              return (
                <div
                  key={di}
                  onDoubleClick={() => openCreate(d)}
                  className={cn(
                    "border-l border-[var(--color-border)] first:border-l-0 px-1.5 py-1 min-h-0 overflow-visible relative group",
                    !inMonth && "bg-[var(--color-fg)]/[0.02] text-[var(--color-fg-muted)]",
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
                    {visible.map((b) => (
                      <div key={b.id + cellKey} className="relative group/m-event">
                        <button
                          onClick={() => openEdit(b)}
                          className="w-full text-left text-[10px] leading-snug truncate rounded px-1.5 py-0.5 text-white hover:opacity-90 pr-4"
                          style={{ backgroundColor: b.color }}
                          title={`${b.title}\n${format(new Date(b.start), "p")} – ${format(new Date(b.end), "p")}`}
                        >
                          {b.allDay
                            ? b.title
                            : `${format(new Date(b.start), "h:mma").toLowerCase()} ${b.title}`}
                        </button>
                        {isWritable(b.id) && (
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
                    ))}
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
      <div className="absolute z-40 mt-1 left-0 w-64 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] shadow-xl p-3">
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
