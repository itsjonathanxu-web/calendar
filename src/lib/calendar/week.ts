import {
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  formatISO,
  isSameDay,
  isWithinInterval,
  startOfDay,
} from "date-fns";

const WEEK_OPTS = { weekStartsOn: 0 as const }; // Sunday

export function weekRange(anchor: Date) {
  const start = startOfWeek(anchor, WEEK_OPTS);
  const end = endOfWeek(anchor, WEEK_OPTS);
  return { start, end };
}

export function weekDays(anchor: Date): Date[] {
  const { start } = weekRange(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function shiftWeek(anchor: Date, dir: 1 | -1): Date {
  return dir === 1 ? addWeeks(anchor, 1) : subWeeks(anchor, 1);
}

export function isoDate(d: Date): string {
  return formatISO(d, { representation: "date" });
}

export function parseAnchor(input: string | undefined | null): Date {
  if (!input) return new Date();
  // Date-only strings ("2026-05-07") are interpreted as UTC midnight by Date(),
  // which in Toronto becomes 8pm the previous day. Append a local time so we get
  // local midnight of the intended day instead.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const d = new Date(dateOnly ? input + "T00:00:00" : input);
  return isNaN(d.getTime()) ? new Date() : d;
}

export type Block = {
  id: string;
  title: string;
  color: string;
  calendarName: string;
  start: Date;
  end: Date;
  allDay: boolean;
};

export type LaidOutBlock = Block & {
  /** Day index 0..6 (Mon..Sun). For multi-day events, repeated per day. */
  dayIndex: number;
  /** Minutes from start of day for visible portion. */
  topMin: number;
  /** Visible duration in minutes within this day. */
  durationMin: number;
  /** Lane index within overlapping cluster. */
  lane: number;
  /** Total lanes in the overlapping cluster. */
  laneCount: number;
};

/** Split a block per day it touches; clip to that day's bounds. */
function splitByDay(block: Block, days: Date[]): Omit<LaidOutBlock, "lane" | "laneCount">[] {
  const out: Omit<LaidOutBlock, "lane" | "laneCount">[] = [];
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const overlaps = block.start < dayEnd && block.end > dayStart;
    if (!overlaps) continue;
    const segStart = block.start > dayStart ? block.start : dayStart;
    const segEnd = block.end < dayEnd ? block.end : dayEnd;
    const topMin = (segStart.getTime() - dayStart.getTime()) / 60_000;
    const durationMin = Math.max(15, (segEnd.getTime() - segStart.getTime()) / 60_000);
    if (typeof window !== "undefined" && (topMin < 0 || topMin > 1440)) {
      // eslint-disable-next-line no-console
      console.warn("[layoutWeek] suspicious topMin", {
        title: block.title,
        topMin,
        dayIndex: i,
        blockStart: block.start.toISOString(),
        dayStart: dayStart.toISOString(),
        blockStartLocal: block.start.toString(),
      });
    }
    out.push({ ...block, dayIndex: i, topMin, durationMin });
  }
  return out;
}

/** Assign lane indices to overlapping blocks within each day. */
export function layoutWeek(blocks: Block[], days: Date[]): { timed: LaidOutBlock[]; allDay: Block[] } {
  const timedSplit: Omit<LaidOutBlock, "lane" | "laneCount">[] = [];
  const allDay: Block[] = [];
  for (const b of blocks) {
    if (b.allDay) {
      // for all-day events, also represent them across days
      allDay.push(b);
    } else {
      timedSplit.push(...splitByDay(b, days));
    }
  }

  const result: LaidOutBlock[] = [];
  for (let d = 0; d < 7; d++) {
    const inDay = timedSplit
      .filter((b) => b.dayIndex === d)
      .sort((a, z) => a.topMin - z.topMin || z.durationMin - a.durationMin);

    const lanes: { endMin: number }[] = [];
    const placed: { item: typeof inDay[number]; lane: number }[] = [];
    for (const item of inDay) {
      let laneIdx = lanes.findIndex((l) => l.endMin <= item.topMin);
      if (laneIdx === -1) {
        laneIdx = lanes.length;
        lanes.push({ endMin: item.topMin + item.durationMin });
      } else {
        lanes[laneIdx].endMin = item.topMin + item.durationMin;
      }
      placed.push({ item, lane: laneIdx });
    }
    // resolve laneCount per-cluster: easy version — all share max lanes for the day
    const laneCount = Math.max(1, lanes.length);
    for (const p of placed) {
      result.push({ ...p.item, lane: p.lane, laneCount });
    }
  }

  return { timed: result, allDay };
}

export { isSameDay, isWithinInterval, addDays };
