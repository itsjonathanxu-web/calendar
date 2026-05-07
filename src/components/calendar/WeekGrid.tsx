"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, isSameDay, addMinutes } from "date-fns";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { layoutWeek, type Block, type LaidOutBlock } from "@/lib/calendar/week";
import { EventDialog, type DialogMode, type WritableCalendar } from "./EventDialog";
import { pushUndo, postJson } from "@/lib/undo";

const HOUR_HEIGHT = 48;
const TOTAL_HEIGHT = 24 * HOUR_HEIGHT;
const SNAP_MIN = 15;
const DAY_MIN = 24 * 60;

type SerBlock = Omit<Block, "start" | "end"> & { start: string; end: string };

function parseLocalDate(s: string): Date {
  // "2026-05-07" → midnight of May 7 in the user's local timezone (instead of
  // UTC midnight, which JS does by default for date-only strings).
  return new Date(s + "T00:00:00");
}

function formatTimeRange(start: Date, end: Date): string {
  const sH = start.getHours();
  const sM = start.getMinutes();
  const eH = end.getHours();
  const eM = end.getMinutes();
  const sPeriod = sH >= 12 ? "PM" : "AM";
  const ePeriod = eH >= 12 ? "PM" : "AM";
  const sH12 = ((sH + 11) % 12) + 1;
  const eH12 = ((eH + 11) % 12) + 1;
  const sStr = sM === 0 ? `${sH12}` : `${sH12}:${String(sM).padStart(2, "0")}`;
  const eStr = eM === 0 ? `${eH12}` : `${eH12}:${String(eM).padStart(2, "0")}`;
  // Same period: "1–2 PM" / "8:30–5:30" — only suffix on the end
  if (sPeriod === ePeriod) return `${sStr}–${eStr} ${ePeriod}`;
  return `${sStr} ${sPeriod}–${eStr} ${ePeriod}`;
}

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

type DragState =
  | {
      kind: "move";
      eventId: string;
      pointerStartY: number;
      pointerStartX: number;
      initialTopMin: number;
      durationMin: number;
      initialDayIndex: number;
      deltaMin: number;
      deltaDay: number;
      // Raw pixel motion since pointer-down. Used to distinguish a click
      // (open dialog) from a tiny drag (move event by less than a snap step).
      pixelDx: number;
      pixelDy: number;
    }
  | {
      kind: "resize";
      eventId: string;
      pointerStartY: number;
      initialDurationMin: number;
      dayIndex: number;
      deltaMin: number;
    }
  | {
      kind: "create";
      startDayIdx: number;
      startMin: number;
      endDayIdx: number;
      endMin: number;
    };

export function WeekGrid({
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
  const dayDates = useMemo(() => {
    // Compute Sunday-anchored week of `anchor` in the user's local timezone.
    const a = parseLocalDate(anchor);
    const dayIdx = a.getDay();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(a);
      d.setDate(d.getDate() - dayIdx + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
  }, [anchor]);
  const blockObjs: Block[] = useMemo(
    () =>
      blocks.map((b) => ({
        ...b,
        start: new Date(b.start),
        end: new Date(b.end),
      })),
    [blocks],
  );
  const { timed, allDay } = useMemo(() => layoutWeek(blockObjs, dayDates), [blockObjs, dayDates]);
  const today = new Date();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<Date>(today);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT - 24;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const todayIdx = dayDates.findIndex((d) => isSameDay(d, now));
  const colTemplate = `56px repeat(${dayDates.length}, minmax(0, 1fr))`;

  function getColWidth(): number {
    if (!gridRef.current) return 0;
    const total = gridRef.current.getBoundingClientRect().width - 56;
    return total / dayDates.length;
  }

  function snap(min: number): number {
    return Math.round(min / SNAP_MIN) * SNAP_MIN;
  }

  function dayCellPointerDown(e: React.PointerEvent<HTMLDivElement>, dayIdx: number) {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const startMin = snap((y / HOUR_HEIGHT) * 60);
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      kind: "create",
      startDayIdx: dayIdx,
      endDayIdx: dayIdx,
      startMin,
      endMin: startMin + 60,
    });
  }

  function openEdit(b: LaidOutBlock) {
    const det = detailsById[b.id];
    if (!det) return;
    setDialog({
      kind: "edit",
      eventId: b.id,
      title: det.title,
      start: b.start,
      end: b.end,
      allDay: det.allDay,
      notes: det.notes,
      calendarId: det.calendarId,
      source: det.source,
      rrule: det.rrule ?? null,
      isInstance: Boolean(det.isInstance),
    });
  }

  function eventPointerDown(e: React.PointerEvent, b: LaidOutBlock) {
    if (!isWritable(b.id)) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      kind: "move",
      eventId: b.id,
      pointerStartY: e.clientY,
      pointerStartX: e.clientX,
      initialTopMin: b.topMin,
      durationMin: b.durationMin,
      initialDayIndex: b.dayIndex,
      deltaMin: 0,
      deltaDay: 0,
      pixelDx: 0,
      pixelDy: 0,
    });
  }

  function resizePointerDown(e: React.PointerEvent, b: LaidOutBlock) {
    if (!isWritable(b.id)) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      kind: "resize",
      eventId: b.id,
      pointerStartY: e.clientY,
      initialDurationMin: b.durationMin,
      dayIndex: b.dayIndex,
      deltaMin: 0,
    });
  }

  function isWritable(eventId: string): boolean {
    const det = detailsById[eventId];
    if (!det) return false;
    if (det.source === "google" || det.source === "notion-mcp") return true;
    if (det.source === "apple") return false; // synced apple events stay read-only here
    return false;
  }

  function pointerToDayIdx(clientX: number): number {
    if (!gridRef.current) return 0;
    const rect = gridRef.current.getBoundingClientRect();
    const colW = getColWidth();
    const x = clientX - rect.left - 56;
    return Math.max(0, Math.min(dayDates.length - 1, Math.floor(x / colW)));
  }

  function pointerToMinutes(clientY: number): number {
    if (!gridRef.current) return 0;
    const rect = gridRef.current.getBoundingClientRect();
    const y = clientY - rect.top;
    return snap(Math.max(0, Math.min(DAY_MIN - SNAP_MIN, (y / HOUR_HEIGHT) * 60)));
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "move") {
      const colW = getColWidth();
      const dy = e.clientY - d.pointerStartY;
      const dx = e.clientX - d.pointerStartX;
      setDrag({
        ...d,
        deltaMin: snap((dy / HOUR_HEIGHT) * 60),
        deltaDay: Math.round(dx / colW),
        pixelDx: dx,
        pixelDy: dy,
      });
    } else if (d.kind === "resize") {
      const dy = e.clientY - d.pointerStartY;
      setDrag({ ...d, deltaMin: snap((dy / HOUR_HEIGHT) * 60) });
    } else if (d.kind === "create") {
      setDrag({ ...d, endDayIdx: pointerToDayIdx(e.clientX), endMin: pointerToMinutes(e.clientY) });
    }
  }

  async function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);

    if (d.kind === "move") {
      // Distinguish a click (no real motion) from a tiny drag using raw
      // pixel delta. Snapped (deltaMin/deltaDay) can both be 0 even when the
      // user clearly dragged (just less than 15 minutes vertically).
      const pxMoved = Math.hypot(d.pixelDx, d.pixelDy);
      if (pxMoved < 4) {
        const block = timed.find((b) => b.id === d.eventId);
        if (block) openEdit(block);
        return;
      }
      // Below the snap threshold but past the click threshold — user dragged
      // but not far enough to register a different time. Don't update, don't
      // pop the dialog.
      if (d.deltaMin === 0 && d.deltaDay === 0) return;
      const block = timed.find((b) => b.id === d.eventId);
      if (!block) return;
      if (!isWritable(block.id)) return;
      const newDayIdx = Math.max(0, Math.min(dayDates.length - 1, block.dayIndex + d.deltaDay));
      const oldStart = block.start;
      const oldEnd = block.end;
      const newStart = new Date(dayDates[newDayIdx]);
      newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
      newStart.setMinutes(newStart.getMinutes() + d.deltaMin);
      const newEnd = addMinutes(newStart, d.durationMin);
      try {
        await fetchPost("/api/events/update", {
          id: d.eventId,
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        });
        pushUndo({
          label: `Move ${block.title}`,
          undo: async () => {
            await postJson("/api/events/update", {
              id: d.eventId,
              start: oldStart.toISOString(),
              end: oldEnd.toISOString(),
            });
          },
          redo: async () => {
            await postJson("/api/events/update", {
              id: d.eventId,
              start: newStart.toISOString(),
              end: newEnd.toISOString(),
            });
          },
        });
      } catch (err) {
        console.error("move failed:", err);
      }
      router.refresh();
    } else if (d.kind === "resize") {
      if (d.deltaMin === 0) return;
      const block = timed.find((b) => b.id === d.eventId);
      if (!block) return;
      const newDuration = Math.max(SNAP_MIN, d.initialDurationMin + d.deltaMin);
      const start = block.start;
      const oldEnd = block.end;
      const end = addMinutes(start, newDuration);
      try {
        await fetchPost("/api/events/update", {
          id: d.eventId,
          start: start.toISOString(),
          end: end.toISOString(),
        });
        pushUndo({
          label: `Resize ${block.title}`,
          undo: async () => {
            await postJson("/api/events/update", {
              id: d.eventId,
              start: start.toISOString(),
              end: oldEnd.toISOString(),
            });
          },
          redo: async () => {
            await postJson("/api/events/update", {
              id: d.eventId,
              start: start.toISOString(),
              end: end.toISOString(),
            });
          },
        });
      } catch (err) {
        console.error("resize failed:", err);
      }
      router.refresh();
    } else if (d.kind === "create") {
      const startTotal = d.startDayIdx * DAY_MIN + d.startMin;
      const endTotal = d.endDayIdx * DAY_MIN + d.endMin;
      const lo = Math.min(startTotal, endTotal);
      const hi = Math.max(startTotal, endTotal);
      const span = Math.max(SNAP_MIN, hi - lo);
      const startDayIdx = Math.floor(lo / DAY_MIN);
      const startMinInDay = lo - startDayIdx * DAY_MIN;
      const start = new Date(dayDates[startDayIdx]);
      start.setMinutes(startMinInDay);
      const end = new Date(start.getTime() + span * 60_000);
      setDialog({ kind: "create", start, end });
    }
  }

  async function quickDelete(eventId: string) {
    if (!confirm("Delete this event?")) return;
    try {
      await fetchPost("/api/events/delete", { id: eventId });
      router.refresh();
    } catch (err) {
      console.error("delete failed:", err);
      alert("Could not delete: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // Compute create-preview slices per day column
  function createPreviewForCol(i: number): { top: number; height: number } | null {
    if (drag?.kind !== "create") return null;
    const startTotal = drag.startDayIdx * DAY_MIN + drag.startMin;
    const endTotal = drag.endDayIdx * DAY_MIN + drag.endMin;
    const lo = Math.min(startTotal, endTotal);
    const hi = Math.max(startTotal, endTotal + (startTotal === endTotal ? SNAP_MIN : 0));
    const colStart = i * DAY_MIN;
    const colEnd = (i + 1) * DAY_MIN;
    if (colEnd <= lo || colStart >= hi) return null;
    const sliceLo = Math.max(lo, colStart) - colStart;
    const sliceHi = Math.min(hi, colEnd) - colStart;
    return {
      top: sliceLo * (HOUR_HEIGHT / 60),
      height: Math.max(SNAP_MIN, sliceHi - sliceLo) * (HOUR_HEIGHT / 60),
    };
  }

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ ["--cols" as string]: colTemplate }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="glass-subtle grid grid-cols-[var(--cols)] border-b border-[var(--color-border)]">
        <div />
        {dayDates.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div
              key={i}
              className={cn(
                "px-2 py-2 text-center border-l border-[var(--color-border)]",
                isToday && "bg-[var(--color-accent)]/[0.06]",
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
                {format(d, "EEE")}
              </div>
              <div
                className={cn(
                  "text-lg font-semibold",
                  isToday ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]",
                )}
              >
                {format(d, "d")}
              </div>
            </div>
          );
        })}
      </div>

      {allDay.length > 0 && (
        <div className="glass-subtle grid grid-cols-[var(--cols)] border-b border-[var(--color-border)]">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] flex items-center">
            All-day
          </div>
          {dayDates.map((d, i) => {
            const items = allDay.filter(
              (b) => b.start <= addDay(d, 1) && b.end > d,
            );
            return (
              <div
                key={i}
                className="border-l border-[var(--color-border)] p-1 space-y-0.5 min-h-[28px]"
              >
                {items.map((it) => (
                  <div key={it.id} className="relative group/allday">
                    <button
                      onClick={() => {
                        const det = detailsById[it.id];
                        if (!det) return;
                        setDialog({
                          kind: "edit",
                          eventId: it.id,
                          title: det.title,
                          start: it.start,
                          end: it.end,
                          allDay: det.allDay,
                          notes: det.notes,
                          calendarId: det.calendarId,
                          source: det.source,
                          rrule: det.rrule ?? null,
                          isInstance: Boolean(det.isInstance),
                        });
                      }}
                      className="event-tile block w-full text-left text-[11px] rounded-md px-2 py-0.5 truncate text-white pr-5"
                      style={{ backgroundColor: muteColor(it.color) }}
                      title={it.title}
                    >
                      {it.title}
                    </button>
                    {isWritable(it.id) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          quickDelete(it.id);
                        }}
                        className="absolute right-0.5 top-0 bottom-0 my-auto h-4 w-4 opacity-0 group-hover/allday:opacity-100 rounded text-white/80 hover:text-white hover:bg-black/20 flex items-center justify-center"
                        aria-label="Delete event"
                        title="Delete"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          className="relative grid grid-cols-[var(--cols)]"
          style={{ height: TOTAL_HEIGHT }}
        >
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-[var(--color-fg-muted)]"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {h === 0 ? "" : format(new Date().setHours(h, 0, 0, 0), "h a")}
              </div>
            ))}
          </div>

          {dayDates.map((_, i) => {
            const preview = createPreviewForCol(i);
            return (
              <div
                key={i}
                onPointerDown={(e) => dayCellPointerDown(e, i)}
                className={cn(
                  "relative border-l border-[var(--color-border)] cursor-crosshair",
                  i === todayIdx && "bg-[var(--color-accent)]/[0.03]",
                )}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-[var(--color-border)]/60 pointer-events-none"
                    style={{ top: h * HOUR_HEIGHT }}
                  />
                ))}

                {i === todayIdx && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: (now.getHours() * 60 + now.getMinutes()) * (HOUR_HEIGHT / 60) }}
                  >
                    <div className="h-px bg-[var(--color-danger)]" />
                    <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-[var(--color-danger)]" />
                  </div>
                )}

                {preview && (
                  <div
                    className="absolute left-0.5 right-0.5 rounded-md border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/[0.15] pointer-events-none z-10"
                    style={{ top: preview.top, height: preview.height }}
                  >
                    <div className="text-[10px] text-[var(--color-accent)] px-1.5 py-0.5">
                      New event
                    </div>
                  </div>
                )}

                {timed
                  .filter((b) => {
                    if (drag?.kind === "move" && drag.eventId === b.id) {
                      const targetIdx = Math.max(
                        0,
                        Math.min(dayDates.length - 1, drag.initialDayIndex + drag.deltaDay),
                      );
                      return targetIdx === i;
                    }
                    return b.dayIndex === i;
                  })
                  .map((b) => {
                    const isMoving = drag?.kind === "move" && drag.eventId === b.id;
                    const isResizing = drag?.kind === "resize" && drag.eventId === b.id;
                    const top = isMoving
                      ? b.topMin * (HOUR_HEIGHT / 60) + drag.deltaMin * (HOUR_HEIGHT / 60)
                      : b.topMin * (HOUR_HEIGHT / 60);
                    const dur = isResizing
                      ? Math.max(SNAP_MIN, drag.initialDurationMin + drag.deltaMin)
                      : b.durationMin;
                    const height = dur * (HOUR_HEIGHT / 60);
                    const widthPct = isMoving ? 100 : 100 / b.laneCount;
                    const leftPct = isMoving ? 0 : b.lane * widthPct;
                    const writable = isWritable(b.id);
                    return (
                      <div
                        key={b.id + ":" + b.dayIndex}
                        onPointerDown={(e) => writable && eventPointerDown(e, b)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!drag) openEdit(b);
                        }}
                        className={cn(
                          "event-tile absolute rounded-lg text-[11px] leading-tight px-1.5 py-1 overflow-hidden text-white group/event",
                          writable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                          (isMoving || isResizing) && "opacity-80 ring-2 ring-white/60 z-20",
                        )}
                        style={{
                          top,
                          height,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: muteColor(b.color),
                        }}
                        title={`${b.title}\n${formatTimeRange(b.start, b.end)}\n${b.calendarName}`}
                      >
                        <div className="font-medium truncate pr-4">{b.title}</div>
                        {height > 28 && (
                          <div className="opacity-80 truncate">{formatTimeRange(b.start, b.end)}</div>
                        )}
                        {writable && (
                          <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              quickDelete(b.id);
                            }}
                            className="absolute right-0.5 top-0.5 h-4 w-4 opacity-0 group-hover/event:opacity-100 rounded text-white/90 hover:text-white hover:bg-black/30 flex items-center justify-center z-10"
                            aria-label="Delete event"
                            title="Delete"
                          >
                            <X size={11} />
                          </button>
                        )}
                        {writable && (
                          <div
                            onPointerDown={(e) => resizePointerDown(e, b)}
                            className="absolute left-0 right-0 bottom-0 h-1.5 cursor-ns-resize bg-white/0 hover:bg-white/30"
                            title="Drag to resize"
                          />
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

      <EventDialog mode={dialog} onClose={() => setDialog(null)} calendars={calendars} />
    </div>
  );
}

// Convert a hex color (#rrggbb) to a muted rgba so the calendar tint shows
// through the glass overlay rather than dominating it. Alpha tuned for
// readability against a dark glass surface.
function muteColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "rgba(120, 120, 130, 0.55)";
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.55)`;
}

function addDay(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

async function fetchPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json();
}
