"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2, GripVertical, ChevronLeft, ChevronRight } from "lucide-react";
import { useReorderDrag } from "@/lib/use-reorder-drag";

// Server passes ISO strings — Date objects formatted on server use the
// container's TZ (UTC on Fly), which made every time on the Today panel
// show 4h off. Parsing in the browser uses local TZ, so toLocaleString
// gives the right answer.

export type TodayItem = {
  id: string;
  start: string;
  end: string;
  title: string;
  notes: string | null;
  allDay: boolean;
  calendarId: string;
  calendar: { name: string; color: string; section: string };
};

type DayOnlyCalendar = { id: string; color: string };

export function TodayPanel({
  schedule,
  tasks,
  dayOnly,
  dayOnlyCalendar,
}: {
  schedule: TodayItem[];
  tasks: TodayItem[];
  dayOnly: TodayItem[];
  dayOnlyCalendar: DayOnlyCalendar | null;
}) {
  const [openNotes, setOpenNotes] = useState<TodayItem | null>(null);
  // dayOffset = 0 today, +1 tomorrow, -1 yesterday. Stepper buttons below
  // adjust this; the filter rebuilds against the right calendar day in the
  // user's local TZ.
  const [dayOffset, setDayOffset] = useState(0);

  const { filterToDay, focusedDay } = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + dayOffset);
    const dayStart = base;
    const dayEnd = new Date(base.getTime() + 24 * 3600_000);
    const cellKey = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;
    const filter = (items: TodayItem[]): TodayItem[] =>
      items.filter((it) => {
        const s = new Date(it.start);
        const e = new Date(it.end);
        if (it.allDay) {
          const sk = s.toISOString().slice(0, 10);
          const ek = e.toISOString().slice(0, 10);
          if (sk === ek) return sk === cellKey;
          return sk <= cellKey && ek > cellKey;
        }
        return s < dayEnd && e > dayStart;
      });
    return { filterToDay: filter, focusedDay: dayStart };
  }, [dayOffset]);

  const todaySchedule = filterToDay(schedule);
  const todayTasks = filterToDay(tasks);
  const todayDayOnly = filterToDay(dayOnly);

  // Friendly heading: "Today", "Tomorrow", or weekday + date for further steps.
  const dayLabel = (() => {
    if (dayOffset === 0) return "Today";
    if (dayOffset === 1) return "Tomorrow";
    if (dayOffset === -1) return "Yesterday";
    return focusedDay.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  })();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
          {dayLabel}
          {dayOffset !== 0 && (
            <span className="ml-2 text-[var(--color-fg-muted)] normal-case tracking-normal">
              {focusedDay.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1 text-[var(--color-fg-muted)]">
          <button
            type="button"
            onClick={() => setDayOffset((o) => o - 1)}
            aria-label="Previous day"
            title="Previous day"
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--color-fg)]/[0.06]"
          >
            <ChevronLeft size={14} />
          </button>
          {dayOffset !== 0 && (
            <button
              type="button"
              onClick={() => setDayOffset(0)}
              className="text-[10px] uppercase tracking-wider px-1.5 h-6 flex items-center rounded-md hover:bg-[var(--color-fg)]/[0.06]"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => setDayOffset((o) => o + 1)}
            aria-label="Next day"
            title="Next day"
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--color-fg)]/[0.06]"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <ItemCard title="Schedule">
        {todaySchedule.length === 0 && <Empty msg="Nothing scheduled." />}
        {todaySchedule.map((e) => (
          <Row key={e.id} item={e} onPickNotes={setOpenNotes} />
        ))}
      </ItemCard>

      <ItemCard
        title="Tasks"
        right={
          <span className="text-[10px] text-[var(--color-fg-muted)]">
            {todayTasks.length} open
          </span>
        }
      >
        {todayTasks.length === 0 && <Empty msg="No tasks for today." />}
        {todayTasks.map((e) => (
          <Row key={e.id} item={e} onPickNotes={setOpenNotes} />
        ))}
      </ItemCard>

      <DayOnlySection
        items={todayDayOnly}
        calendar={dayOnlyCalendar}
        onPickNotes={setOpenNotes}
      />

      {openNotes && (
        <NotesDialog item={openNotes} onClose={() => setOpenNotes(null)} />
      )}
    </section>
  );
}

function ItemCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-sm text-[var(--color-fg-muted)] py-2">{msg}</div>;
}

function Row({
  item,
  onPickNotes,
}: {
  item: TodayItem;
  onPickNotes: (i: TodayItem) => void;
}) {
  const start = new Date(item.start);
  const end = new Date(item.end);
  const hasNotes = (item.notes ?? "").trim().length > 0;
  return (
    <button
      onClick={() => hasNotes && onPickNotes(item)}
      disabled={!hasNotes}
      className={
        "w-full flex items-center gap-2 text-sm py-0.5 text-left rounded " +
        (hasNotes ? "hover:bg-white/[0.04] cursor-pointer px-1 -mx-1" : "cursor-default")
      }
      title={hasNotes ? "Click to view notes" : undefined}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: item.calendar.color }}
      />
      <span className="text-[var(--color-fg-muted)] tabular-nums w-20 shrink-0 text-xs">
        {item.allDay ? "all-day" : formatRange(start, end)}
      </span>
      <span className="truncate flex-1">{item.title}</span>
      {hasNotes && <span className="text-[10px] text-[var(--color-fg-muted)]">📝</span>}
    </button>
  );
}

function DayOnlySection({
  items,
  calendar,
  onPickNotes,
}: {
  items: TodayItem[];
  calendar: DayOnlyCalendar | null;
  onPickNotes: (i: TodayItem) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!text.trim() || !calendar || busy) return;
    setBusy(true);
    try {
      // Pin to local "today" + nudge by N seconds so the new note appears at
      // the END of the existing list. Each next add picks up by reading the
      // current count.
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setSeconds(start.getSeconds() + items.length);
      const end = new Date(start.getTime() + 24 * 3600_000);
      await fetch("/api/events/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calendarId: calendar.id,
          title: text.trim(),
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: true,
        }),
      });
      setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch("/api/events/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reorder(from: number, to: number) {
    if (from === to) return;
    setBusy(true);
    try {
      // Reassign start timestamps so the asc-by-start order matches the new
      // arrangement. Use today's local midnight + (idx) seconds — preserves
      // each item's duration (24h all-day fallback otherwise).
      const next = items.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      await Promise.all(
        next.map((it, i) => {
          const newStart = new Date(dayStart.getTime() + i * 1000);
          const dur = new Date(it.end).getTime() - new Date(it.start).getTime();
          const newEnd = new Date(newStart.getTime() + dur);
          return fetch("/api/events/update", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: it.id,
              start: newStart.toISOString(),
              end: newEnd.toISOString(),
            }),
          });
        }),
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const { onPointerDown, draggingIdx, overIdx } = useReorderDrag({ onDrop: reorder });

  return (
    <div className="glass rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Just for today
        </div>
      </div>
      {items.length === 0 && (
        <div className="text-sm text-[var(--color-fg-muted)] py-1">
          {calendar
            ? "Nothing yet — add a quick note below."
            : "Save the page once to enable this section."}
        </div>
      )}
      {items.map((e, i) => (
        <DayOnlyRow
          key={e.id}
          item={e}
          index={i}
          onPickNotes={onPickNotes}
          onPointerDown={(ev) => onPointerDown(ev, i)}
          dragging={draggingIdx === i}
          dragOver={overIdx === i && draggingIdx !== null && draggingIdx !== i}
          onDelete={() => remove(e.id)}
        />
      ))}
      {calendar && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            add();
          }}
          className="flex items-center gap-2 pt-1"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a note for today…"
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            aria-label="Add"
            className="rounded-md bg-white/10 hover:bg-white/15 w-7 h-7 flex items-center justify-center disabled:opacity-30"
          >
            <Plus size={12} />
          </button>
        </form>
      )}
    </div>
  );
}

function DayOnlyRow({
  item,
  index,
  onPickNotes,
  onPointerDown,
  dragging,
  dragOver,
  onDelete,
}: {
  item: TodayItem;
  index: number;
  onPickNotes: (i: TodayItem) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  dragging: boolean;
  dragOver: boolean;
  onDelete: () => void;
}) {
  const hasNotes = (item.notes ?? "").trim().length > 0;
  return (
    <div
      data-row-idx={index}
      onPointerDown={onPointerDown}
      className={
        "group/dayrow flex items-center gap-2 text-sm py-0.5 -mx-1 px-1 rounded hover:bg-white/[0.04] touch-none select-none transition-colors " +
        (dragging ? "opacity-50 ring-1 ring-white/40" : "") +
        (dragOver ? " bg-white/[0.08]" : "")
      }
    >
      <span
        aria-hidden
        className="w-3 h-5 flex items-center justify-center text-[var(--color-fg-muted)]/60 cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={10} />
      </span>
      <span className="w-2 h-2 rounded-full shrink-0 bg-white/40" />
      <button
        onClick={() => hasNotes && onPickNotes(item)}
        disabled={!hasNotes}
        className={
          "flex-1 min-w-0 text-left truncate " + (hasNotes ? "cursor-pointer" : "cursor-default")
        }
      >
        {item.title}
      </button>
      <div className="opacity-0 group-hover/dayrow:opacity-100 transition-opacity flex items-center">
        <button
          onClick={onDelete}
          aria-label="Delete"
          title="Delete"
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] hover:bg-white/[0.06]"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

function NotesDialog({
  item,
  onClose,
}: {
  item: TodayItem;
  onClose: () => void;
}) {
  const start = new Date(item.start);
  const end = new Date(item.end);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong w-full max-w-2xl max-h-[80vh] rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <div className="text-base font-semibold tracking-tight">{item.title}</div>
            <div className="text-xs text-[var(--color-fg-muted)] mt-0.5 flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: item.calendar.color }}
              />
              {item.calendar.name} · {item.allDay ? "all-day" : formatRange(start, end)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/[0.06] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 text-sm whitespace-pre-wrap leading-relaxed">
          {item.notes ?? "(no notes)"}
        </div>
      </div>
    </div>
  );
}

function formatRange(start: Date, end: Date): string {
  const sH = start.getHours();
  const sM = start.getMinutes();
  const eH = end.getHours();
  const eM = end.getMinutes();
  const sP = sH >= 12 ? "PM" : "AM";
  const eP = eH >= 12 ? "PM" : "AM";
  const sH12 = ((sH + 11) % 12) + 1;
  const eH12 = ((eH + 11) % 12) + 1;
  const s = sM === 0 ? `${sH12}` : `${sH12}:${String(sM).padStart(2, "0")}`;
  const e = eM === 0 ? `${eH12}` : `${eH12}:${String(eM).padStart(2, "0")}`;
  if (sP === eP) return `${s}–${e} ${eP}`;
  return `${s} ${sP}–${e} ${eP}`;
}
