import { RRule } from "rrule";

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceSpec = {
  freq: RecurrenceFreq;
  interval?: number; // every N days/weeks/months
  byweekday?: number[]; // 0=Mon..6=Sun (rrule convention)
  until?: Date | null;
  count?: number | null;
};

/**
 * Build an RRULE string from a structured spec.
 * Returns the RRULE part only (no DTSTART) — that's stored in Event.start.
 */
export function buildRRuleString(spec: RecurrenceSpec): string {
  const parts: string[] = [`FREQ=${spec.freq}`];
  if (spec.interval && spec.interval > 1) parts.push(`INTERVAL=${spec.interval}`);
  if (spec.byweekday && spec.byweekday.length > 0) {
    const map = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    parts.push(`BYDAY=${spec.byweekday.map((d) => map[d]).join(",")}`);
  }
  if (spec.until) {
    parts.push(`UNTIL=${spec.until.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  } else if (spec.count) {
    parts.push(`COUNT=${spec.count}`);
  }
  return parts.join(";");
}

/**
 * Parse a stored RRULE string back into a structured spec.
 */
export function parseRRuleString(rruleStr: string): RecurrenceSpec | null {
  if (!rruleStr) return null;
  try {
    const opts = RRule.parseString(rruleStr);
    const map: Record<number, RecurrenceFreq> = {
      [RRule.DAILY]: "DAILY",
      [RRule.WEEKLY]: "WEEKLY",
      [RRule.MONTHLY]: "MONTHLY",
      [RRule.YEARLY]: "YEARLY",
    };
    const freq = opts.freq !== undefined ? map[opts.freq as number] : undefined;
    if (!freq) return null;
    return {
      freq,
      interval: opts.interval ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      byweekday: Array.isArray(opts.byweekday) ? (opts.byweekday as any[]).map((d) => (typeof d === "number" ? d : d.weekday)) : undefined,
      until: opts.until ?? null,
      count: opts.count ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Expand a recurring event into all instance start times within [windowStart, windowEnd].
 * Limited to 500 instances to prevent runaway expansion.
 */
export function expandRRule(
  masterStart: Date,
  rruleStr: string,
  windowStart: Date,
  windowEnd: Date,
): Date[] {
  try {
    const opts = RRule.parseString(rruleStr);
    opts.dtstart = masterStart;
    const rule = new RRule(opts);
    const dates = rule.between(windowStart, windowEnd, true);
    return dates.slice(0, 500);
  } catch (err) {
    console.error("[recurrence] expand failed:", err);
    return [];
  }
}

/**
 * Synthetic event id for a recurring instance: `${masterId}::${ISO}`.
 * Edit handlers use this to determine "is this a virtual instance?" — if so they
 * decide whether the user wants edit-this/edit-this+future/edit-all.
 */
export function instanceId(masterId: string, occurrence: Date): string {
  return `${masterId}::${occurrence.toISOString()}`;
}

export function parseInstanceId(id: string): { masterId: string; occurrence: Date } | null {
  const idx = id.indexOf("::");
  if (idx === -1) return null;
  const masterId = id.slice(0, idx);
  const dateStr = id.slice(idx + 2);
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return { masterId, occurrence: d };
}

export function isInstanceId(id: string): boolean {
  return id.includes("::");
}
