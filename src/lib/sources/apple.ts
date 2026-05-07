import { createDAVClient, type DAVCalendar } from "tsdav";
import ICAL from "ical.js";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

type Creds = { username: string; password: string };

const CALDAV_URL = "https://caldav.icloud.com";

const COLOR_PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899",
];

async function makeClient(creds: Creds) {
  return createDAVClient({
    serverUrl: CALDAV_URL,
    credentials: { username: creds.username, password: creds.password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

async function clientForAccount(accountId: string) {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account || account.source !== "apple") throw new Error("Account not found");
  const creds: Creds = JSON.parse(decrypt(account.credentials));
  return makeClient(creds);
}

export async function verifyAndSave(creds: Creds): Promise<string> {
  // verify by fetching calendars
  const c = await makeClient(creds);
  await c.fetchCalendars();
  const account = await db.account.upsert({
    where: { source_label: { source: "apple", label: creds.username } },
    create: {
      source: "apple",
      label: creds.username,
      credentials: encrypt(JSON.stringify(creds satisfies Creds)),
    },
    update: { credentials: encrypt(JSON.stringify(creds satisfies Creds)) },
  });
  return account.id;
}

function calendarPath(cal: DAVCalendar): string {
  return cal.url ?? String(cal.displayName ?? "");
}

function calendarColor(cal: DAVCalendar, fallbackIdx: number): string {
  // CalendarServer-stored color appears as "calendar-color" — tsdav surfaces it on the object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (cal as any).calendarColor as string | undefined;
  if (c && /^#?[0-9a-fA-F]{6}/.test(c)) {
    return c.startsWith("#") ? c.slice(0, 7) : `#${c.slice(0, 6)}`;
  }
  return COLOR_PALETTE[fallbackIdx % COLOR_PALETTE.length];
}

export async function syncCalendars(accountId: string): Promise<number> {
  const c = await clientForAccount(accountId);
  const cals = await c.fetchCalendars();
  let i = 0;
  for (const cal of cals) {
    // Some Apple calendars are read-only system calendars (Birthdays, etc.). Include them all for now.
    const sourceId = calendarPath(cal);
    if (!sourceId) continue;
    const name = String(cal.displayName ?? "Calendar");
    await db.calendar.upsert({
      where: { accountId_sourceId: { accountId, sourceId } },
      create: {
        accountId,
        sourceId,
        name,
        color: calendarColor(cal, i),
      },
      update: { name, color: calendarColor(cal, i) },
    });
    i += 1;
  }
  await db.account.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
  return cals.length;
}

type ParsedEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  notes?: string | null;
};

function parseICS(ics: string, windowStart: Date, windowEnd: Date): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  let jcal: unknown;
  try {
    jcal = ICAL.parse(ics);
  } catch {
    return out;
  }
  const comp = new ICAL.Component(jcal as unknown as unknown[]);
  const vevents = comp.getAllSubcomponents("vevent");
  for (const vevent of vevents) {
    try {
      const ev = new ICAL.Event(vevent);
      const uid = ev.uid;
      const summary = ev.summary || "(untitled)";
      const description = ev.description || null;

      if (ev.isRecurring()) {
        const it = ev.iterator();
        let next: ICAL.Time | null = null;
        // safety cap
        for (let i = 0; i < 500; i++) {
          next = it.next() as ICAL.Time | null;
          if (!next) break;
          const startDate = next.toJSDate();
          if (startDate > windowEnd) break;
          const occ = ev.getOccurrenceDetails(next);
          const endDate = occ.endDate.toJSDate();
          if (endDate < windowStart) continue;
          out.push({
            uid: `${uid}::${next.toString()}`,
            title: occ.item.summary || summary,
            start: startDate,
            end: endDate,
            allDay: Boolean(next.isDate),
            notes: description,
          });
        }
      } else {
        const start = ev.startDate.toJSDate();
        const end = ev.endDate.toJSDate();
        if (end < windowStart || start > windowEnd) continue;
        out.push({
          uid,
          title: summary,
          start,
          end,
          allDay: Boolean(ev.startDate.isDate),
          notes: description,
        });
      }
    } catch (err) {
      console.warn("ical parse error:", err);
    }
  }
  return out;
}

export async function syncEvents(
  accountId: string,
  opts: { backDays?: number; forwardDays?: number } = {},
): Promise<number> {
  const backDays = opts.backDays ?? 30;
  const forwardDays = opts.forwardDays ?? 90;
  const windowStart = new Date(Date.now() - backDays * 86400_000);
  const windowEnd = new Date(Date.now() + forwardDays * 86400_000);

  const c = await clientForAccount(accountId);
  const calendars = await db.calendar.findMany({ where: { accountId, enabled: true } });
  const remoteCals = await c.fetchCalendars();

  console.log(
    `[apple] account=${accountId}: ${calendars.length} enabled cals (db) / ${remoteCals.length} cals (remote)`,
  );

  let total = 0;
  for (const cal of calendars) {
    let remote = remoteCals.find((r) => calendarPath(r) === cal.sourceId);
    // Fallback: match by displayName if url shape changed
    if (!remote) {
      remote = remoteCals.find((r) => String(r.displayName ?? "") === cal.name);
    }
    if (!remote) {
      console.warn(`[apple] no remote match for "${cal.name}" (sourceId=${cal.sourceId})`);
      continue;
    }

    let objects: Awaited<ReturnType<typeof c.fetchCalendarObjects>> = [];
    try {
      objects = await c.fetchCalendarObjects({
        calendar: remote,
        timeRange: {
          start: windowStart.toISOString(),
          end: windowEnd.toISOString(),
        },
      });
    } catch (err) {
      console.warn(`[apple] fetchCalendarObjects failed for "${cal.name}":`, err);
      continue;
    }

    let parsedCount = 0;
    const seen = new Set<string>();
    for (const obj of objects) {
      const ics = obj.data;
      if (!ics) continue;
      let events: ParsedEvent[] = [];
      try {
        events = parseICS(ics, windowStart, windowEnd);
      } catch (err) {
        console.warn(`[apple] parseICS failed in "${cal.name}":`, err);
        continue;
      }
      for (const ev of events) {
        seen.add(ev.uid);
        try {
          await db.event.upsert({
            where: { calendarId_sourceId: { calendarId: cal.id, sourceId: ev.uid } },
            create: {
              calendarId: cal.id,
              sourceId: ev.uid,
              title: ev.title,
              start: ev.start,
              end: ev.end,
              allDay: ev.allDay,
              notes: ev.notes ?? null,
              kind: "event",
              raw: ics,
            },
            update: {
              title: ev.title,
              start: ev.start,
              end: ev.end,
              allDay: ev.allDay,
              notes: ev.notes ?? null,
              raw: ics,
            },
          });
          parsedCount += 1;
        } catch (err) {
          console.warn(`[apple] db upsert failed for ${ev.uid}:`, err);
        }
      }
    }
    console.log(`[apple] "${cal.name}": ${objects.length} ics objects → ${parsedCount} events`);
    total += parsedCount;

    // Drop stale events in window — only ones that came from the iCloud sync (kind="event").
    // Locally-added items (kind="task") are preserved across syncs.
    await db.event.deleteMany({
      where: {
        calendarId: cal.id,
        start: { gte: windowStart, lte: windowEnd },
        sourceId: { notIn: Array.from(seen) },
        kind: "event",
      },
    });
  }

  await db.account.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
  return total;
}

export async function pull(accountId: string): Promise<{ calendars: number; events: number }> {
  const calendars = await syncCalendars(accountId);
  const events = await syncEvents(accountId);
  return { calendars, events };
}
