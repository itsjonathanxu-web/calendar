import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addDays,
  addMonths,
  subMonths,
  formatISO,
  startOfQuarter,
  endOfQuarter,
  addQuarters,
  subQuarters,
} from "date-fns";

export type ViewName = "day" | "week" | "month" | "quarter";
export const VIEWS: ViewName[] = ["day", "week", "month", "quarter"];

const WEEK_OPTS = { weekStartsOn: 0 as const }; // Sunday

export function rangeForView(view: ViewName, anchor: Date): { start: Date; end: Date } {
  switch (view) {
    case "day":
      return { start: startOfDay(anchor), end: endOfDay(anchor) };
    case "week":
      return { start: startOfWeek(anchor, WEEK_OPTS), end: endOfWeek(anchor, WEEK_OPTS) };
    case "month": {
      const ms = startOfMonth(anchor);
      const me = endOfMonth(anchor);
      return { start: startOfWeek(ms, WEEK_OPTS), end: endOfWeek(me, WEEK_OPTS) };
    }
    case "quarter":
      return { start: startOfQuarter(anchor), end: endOfQuarter(anchor) };
  }
}

export function shiftAnchor(view: ViewName, anchor: Date, dir: 1 | -1): Date {
  switch (view) {
    case "day":
      return addDays(anchor, dir);
    case "week":
      return addDays(anchor, dir * 7);
    case "month":
      return dir === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1);
    case "quarter":
      return dir === 1 ? addQuarters(anchor, 1) : subQuarters(anchor, 1);
  }
}

export function isoDate(d: Date): string {
  return formatISO(d, { representation: "date" });
}

export function monthDays(anchor: Date): Date[] {
  const ms = startOfMonth(anchor);
  const me = endOfMonth(anchor);
  const start = startOfWeek(ms, WEEK_OPTS);
  const end = endOfWeek(me, WEEK_OPTS);
  const days: Date[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
