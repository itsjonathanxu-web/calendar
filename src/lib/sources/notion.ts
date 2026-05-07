import { Client } from "@notionhq/client";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

type Creds = { token: string };

const COLOR_PALETTE = [
  "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

function client(token: string) {
  return new Client({ auth: token });
}

async function clientForAccount(accountId: string): Promise<Client> {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account || account.source !== "notion") throw new Error("Account not found");
  const { token }: Creds = JSON.parse(decrypt(account.credentials));
  return client(token);
}

/** Verify a token, return integration label (workspace name if available). */
export async function verifyToken(token: string): Promise<string> {
  const c = client(token);
  const me = await c.users.me({});
  return me.name ?? "Notion";
}

export async function saveAccount(token: string): Promise<string> {
  const label = await verifyToken(token);
  const account = await db.account.upsert({
    where: { source_label: { source: "notion", label } },
    create: {
      source: "notion",
      label,
      credentials: encrypt(JSON.stringify({ token } satisfies Creds)),
    },
    update: { credentials: encrypt(JSON.stringify({ token } satisfies Creds)) },
  });
  return account.id;
}

type DiscoveredDataSource = {
  id: string;
  title: string;
  dateProperty?: string;
  titleProperty?: string;
};

// Pick the most "calendar-like" date property when a DB has several. Lower index = preferred.
const DATE_PRIORITY = [
  "due date", "due", "deadline",
  "scheduled", "scheduled date", "schedule",
  "when", "date", "day",
  "start date", "start", "do date", "action date",
  "event date", "event",
];

function pickDateProperty(props: Record<string, { type: string }>): string | undefined {
  const dateProps = Object.entries(props)
    .filter(([, p]) => p.type === "date")
    .map(([name]) => name);
  if (dateProps.length === 0) return undefined;
  if (dateProps.length === 1) return dateProps[0];
  // Pick by priority match (case-insensitive substring)
  for (const needle of DATE_PRIORITY) {
    const hit = dateProps.find((name) => name.toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return dateProps[0];
}

/**
 * Search Notion for data sources the integration can access, and
 * inspect each one to find a date property to use as the calendar date.
 * Notion's 2025-09-03 API splits databases into data_sources.
 */
async function discoverDataSources(c: Client): Promise<DiscoveredDataSource[]> {
  const results: DiscoveredDataSource[] = [];
  let cursor: string | undefined;
  do {
    const res = await c.search({
      filter: { property: "object", value: "data_source" },
      page_size: 100,
      start_cursor: cursor,
    });
    for (const item of res.results) {
      // narrow to data_source object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = item as any;
      if (it.object !== "data_source") continue;
      const title = (it.title?.[0]?.plain_text as string | undefined) ?? "(untitled)";
      const props = (it.properties ?? {}) as Record<string, { type: string }>;
      const dateProperty = pickDateProperty(props);
      let titleProperty: string | undefined;
      for (const [name, p] of Object.entries(props)) {
        if (!titleProperty && p.type === "title") titleProperty = name;
      }
      results.push({ id: it.id, title, dateProperty, titleProperty });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return results;
}

/** Pull data source list and create Calendar rows for each. Disabled by default. */
export async function syncCalendars(accountId: string): Promise<number> {
  const c = await clientForAccount(accountId);
  const sources = await discoverDataSources(c);
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const existing = await db.calendar.findUnique({
      where: { accountId_sourceId: { accountId, sourceId: s.id } },
    });
    const config = JSON.stringify({
      dateProperty: s.dateProperty ?? null,
      titleProperty: s.titleProperty ?? "Name",
    });
    if (existing) {
      await db.calendar.update({
        where: { id: existing.id },
        data: { name: s.title, config },
      });
    } else {
      await db.calendar.create({
        data: {
          accountId,
          sourceId: s.id,
          name: s.title,
          color: COLOR_PALETTE[i % COLOR_PALETTE.length],
          config,
          // Default to ON if the DB has a usable date property; OFF otherwise (no events would sync anyway).
          enabled: Boolean(s.dateProperty),
        },
      });
    }
  }
  await db.account.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
  return sources.length;
}

/** Pull pages with a date property into Events. Only enabled calendars are synced. */
export async function syncEvents(
  accountId: string,
  opts: { backDays?: number; forwardDays?: number } = {},
): Promise<number> {
  const c = await clientForAccount(accountId);
  const calendars = await db.calendar.findMany({ where: { accountId, enabled: true } });
  const backDays = opts.backDays ?? 30;
  const forwardDays = opts.forwardDays ?? 90;
  const minDate = new Date(Date.now() - backDays * 86400_000);
  const maxDate = new Date(Date.now() + forwardDays * 86400_000);

  let total = 0;
  for (const cal of calendars) {
    const cfg = (cal.config ? JSON.parse(cal.config) : {}) as {
      dateProperty?: string;
      titleProperty?: string;
    };
    if (!cfg.dateProperty) continue;

    const pages: unknown[] = [];
    let cursor: string | undefined;
    do {
      const res = await c.dataSources.query({
        data_source_id: cal.sourceId,
        filter: {
          and: [
            {
              property: cfg.dateProperty,
              date: { on_or_after: minDate.toISOString().slice(0, 10) },
            },
            {
              property: cfg.dateProperty,
              date: { on_or_before: maxDate.toISOString().slice(0, 10) },
            },
          ],
        },
        page_size: 100,
        start_cursor: cursor,
      });
      pages.push(...res.results);
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);

    // Track ids we saw, to remove stale events later
    const seen = new Set<string>();

    for (const raw of pages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = raw as any;
      if (p.object !== "page" || p.archived) continue;
      const props = p.properties as Record<string, unknown>;

      // Extract date
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dateProp = props[cfg.dateProperty!] as any;
      if (!dateProp || dateProp.type !== "date" || !dateProp.date) continue;
      const startStr: string = dateProp.date.start;
      const endStr: string | null = dateProp.date.end;
      const hasTime = startStr.includes("T");
      const start = new Date(startStr);
      const end = endStr
        ? new Date(endStr)
        : hasTime
          ? new Date(start.getTime() + 60 * 60 * 1000)
          : new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
      const allDay = !hasTime;

      // Extract title
      const titlePropName = cfg.titleProperty ?? "Name";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const titleProp = (props[titlePropName] ?? Object.values(props).find((x: any) => x?.type === "title")) as any;
      const title =
        titleProp?.title?.[0]?.plain_text ??
        titleProp?.title?.map((t: { plain_text: string }) => t.plain_text).join("") ??
        "(untitled)";

      seen.add(p.id);
      await db.event.upsert({
        where: { calendarId_sourceId: { calendarId: cal.id, sourceId: p.id } },
        create: {
          calendarId: cal.id,
          sourceId: p.id,
          title,
          start,
          end,
          allDay,
          kind: "task",
          notes: p.url ?? null,
          raw: JSON.stringify(p),
        },
        update: {
          title,
          start,
          end,
          allDay,
          notes: p.url ?? null,
          raw: JSON.stringify(p),
        },
      });
    }

    // Remove events that disappeared from the source within window
    await db.event.deleteMany({
      where: {
        calendarId: cal.id,
        start: { gte: minDate, lte: maxDate },
        sourceId: { notIn: Array.from(seen) },
      },
    });

    total += pages.length;
  }

  await db.account.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
  return total;
}

export async function pull(accountId: string): Promise<{ calendars: number; events: number }> {
  const calendars = await syncCalendars(accountId);
  const events = await syncEvents(accountId);
  return { calendars, events };
}

export async function setCalendarEnabled(calendarId: string, enabled: boolean) {
  await db.calendar.update({ where: { id: calendarId }, data: { enabled } });
}

// ── Writeback ──────────────────────────────────────────────────────────────

function toNotionDate(start: Date, end: Date, allDay: boolean) {
  if (allDay) {
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10) === start.toISOString().slice(0, 10)
        ? null
        : end.toISOString().slice(0, 10),
    };
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function updateEventDate(
  eventRowId: string,
  input: { start: Date; end: Date; allDay: boolean },
): Promise<void> {
  const ev = await db.event.findUnique({
    where: { id: eventRowId },
    include: { calendar: true },
  });
  if (!ev) throw new Error("Event not found");
  const cal = ev.calendar;
  const cfg = (cal.config ? JSON.parse(cal.config) : {}) as { dateProperty?: string };
  if (!cfg.dateProperty) throw new Error("No date property configured for this Notion DB");
  const c = await clientForAccount(cal.accountId);
  await c.pages.update({
    page_id: ev.sourceId,
    properties: {
      [cfg.dateProperty]: { type: "date", date: toNotionDate(input.start, input.end, input.allDay) },
    },
  });
  await db.event.update({
    where: { id: eventRowId },
    data: { start: input.start, end: input.end, allDay: input.allDay },
  });
}

export async function archiveEvent(eventRowId: string): Promise<void> {
  const ev = await db.event.findUnique({ where: { id: eventRowId } });
  if (!ev) return;
  const cal = await db.calendar.findUnique({ where: { id: ev.calendarId } });
  if (!cal) return;
  const c = await clientForAccount(cal.accountId);
  await c.pages.update({ page_id: ev.sourceId, archived: true });
  await db.event.delete({ where: { id: eventRowId } }).catch(() => {});
}
