"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, isSameDay, isBefore, startOfDay } from "date-fns";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { Block } from "@/lib/calendar/week";
import { EventDialog, type DialogMode, type WritableCalendar } from "./EventDialog";
import { useDeviceFilter } from "@/lib/use-device-filter";

// Apple Calendar-style scrolling agenda view used on mobile in place of the
// week-grid. Renders the 7 days of the anchor's week as stacked sections; each
// section is a list of events with a colored stripe, title, calendar/notes
// subtitle, and a stacked start/end time. Empty days collapse to a single
// "+ Add" affordance so the list stays scannable.

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

function parseLocalDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function formatTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  const mm = String(m).padStart(2, "0");
  return `${h12}:${mm}${period}`;
}

export function MobileWeekList({
  anchor,
  blocks,
  calendars = [],
  detailsById = {},
}: {
  anchor: string;
  blocks: SerBlock[];
  calendars?: WritableCalendar[];
  detailsById?: Record<string, EventDetails>;
}) {
  const router = useRouter();
  const { isEnabled, ready } = useDeviceFilter();
  const [dialog, setDialog] = useState<DialogMode>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dayDates = useMemo(() => {
    const a = parseLocalDate(anchor);
    const dayIdx = a.getDay();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(a);
      d.setDate(d.getDate() - dayIdx + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
  }, [anchor]);

  const today = new Date();

  function blocksForDay(d: Date): SerBlock[] {
    const cellKey = format(d, "yyyy-MM-dd");
    return blocks
      .filter((b) => {
        const det = detailsById[b.id];
        if (ready && det && !isEnabled(det.calendarId)) return false;
        const startD = new Date(b.start);
        const endD = new Date(b.end);
        if (b.allDay) {
          const startKey = startD.toISOString().slice(0, 10);
          const endKey = endD.toISOString().slice(0, 10);
          if (startKey === endKey) return startKey === cellKey;
          return startKey <= cellKey && endKey > cellKey;
        }
        const ds = startOfDay(d);
        const dayEnd = new Date(ds.getTime() + 86400_000);
        return startD < dayEnd && endD > ds;
      })
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
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

  function openCreate(d: Date) {
    const start = new Date(d);
    start.setHours(9, 0, 0, 0);
    const end = new Date(d);
    end.setHours(10, 0, 0, 0);
    setDialog({ kind: "create", start, end });
  }

  // On first paint, scroll today's section to the top so the user lands on
  // the most relevant day (mirrors Apple's behavior of opening on today).
  useEffect(() => {
    const t = todayRef.current;
    const sc = scrollRef.current;
    if (!t || !sc) return;
    const offsetTop = t.offsetTop - sc.offsetTop;
    sc.scrollTop = Math.max(0, offsetTop - 8);
  }, [anchor]);

  function scrollToToday() {
    const t = todayRef.current;
    const sc = scrollRef.current;
    if (!t || !sc) return;
    sc.scrollTo({
      top: Math.max(0, t.offsetTop - sc.offsetTop - 8),
      behavior: "smooth",
    });
  }

  return (
    <div className="flex flex-col h-full relative">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-24">
        {dayDates.map((d) => {
          const items = blocksForDay(d);
          const isToday = isSameDay(d, today);
          const isPast = isBefore(d, startOfDay(today)) && !isToday;
          return (
            <div
              key={format(d, "yyyy-MM-dd")}
              ref={isToday ? todayRef : undefined}
              className="pt-4"
            >
              <div
                className={cn(
                  "text-xs font-semibold tracking-wide pb-1.5 mb-2 border-b border-[var(--color-border)]",
                  isToday
                    ? "text-[var(--color-danger)]"
                    : isPast
                      ? "text-[var(--color-fg-muted)]/50"
                      : "text-[var(--color-fg)]",
                )}
              >
                {format(d, "EEEE – MMMM d")}
              </div>
              {items.length === 0 ? (
                <button
                  onClick={() => openCreate(d)}
                  className="text-xs text-[var(--color-fg-muted)] py-2 w-full text-left hover:text-[var(--color-fg)]"
                >
                  + Add event
                </button>
              ) : (
                <div className="space-y-1">
                  {items.map((b) => {
                    const det = detailsById[b.id];
                    const subtitle = det?.notes
                      ? det.notes.split("\n")[0]
                      : b.calendarName;
                    return (
                      <button
                        key={b.id + format(d, "yyyy-MM-dd")}
                        onClick={() => openEdit(b)}
                        className="w-full flex items-stretch gap-3 text-left rounded-lg active:bg-white/[0.06] p-2 -mx-2"
                      >
                        <span
                          className="w-1 rounded-full shrink-0 self-stretch"
                          style={{ backgroundColor: b.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-semibold leading-snug truncate">
                            {b.title}
                          </div>
                          {subtitle && (
                            <div className="text-xs text-[var(--color-fg-muted)] truncate mt-0.5">
                              {subtitle}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-[var(--color-fg-muted)] tabular-nums text-right shrink-0 leading-tight pl-1">
                          {b.allDay ? (
                            <span>all-day</span>
                          ) : (
                            <>
                              <div>{formatTime(new Date(b.start))}</div>
                              <div>{formatTime(new Date(b.end))}</div>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={scrollToToday}
        className="glass-strong absolute bottom-4 left-4 z-20 text-xs px-3 py-1.5 rounded-full shadow-lg"
      >
        Today
      </button>

      <EventDialog
        mode={dialog}
        onClose={() => {
          setDialog(null);
          router.refresh();
        }}
        calendars={calendars}
      />
    </div>
  );
}
