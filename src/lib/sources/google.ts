import { google, type calendar_v3, type Auth } from "googleapis";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

type StoredCreds = Auth.Credentials;

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function oauth(): Auth.OAuth2Client {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/sources/google/callback";
  if (!id || !secret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing in .env");
  }
  return new google.auth.OAuth2(id, secret, redirect);
}

export function consentUrl(state: string): string {
  return oauth().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensure we get a refresh_token
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(code: string): Promise<StoredCreds> {
  const client = oauth();
  const { tokens } = await client.getToken(code);
  return tokens as StoredCreds;
}

async function clientForAccount(accountId: string): Promise<Auth.OAuth2Client> {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Account not found");
  if (account.source !== "google") throw new Error("Not a Google account");
  const creds: StoredCreds = JSON.parse(decrypt(account.credentials));
  const client = oauth();
  client.setCredentials(creds);

  // persist refreshed tokens automatically
  client.on("tokens", async (next) => {
    const merged: StoredCreds = { ...creds, ...next };
    await db.account.update({
      where: { id: accountId },
      data: { credentials: encrypt(JSON.stringify(merged)) },
    });
  });

  return client;
}

async function userEmailFromTokens(client: Auth.OAuth2Client): Promise<string> {
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  return data.email ?? "google";
}

/**
 * Save tokens as a new Account (or update if same email already connected).
 * Returns the account id.
 */
export async function saveAccountFromTokens(creds: StoredCreds): Promise<string> {
  const client = oauth();
  client.setCredentials(creds);
  const email = await userEmailFromTokens(client);
  const account = await db.account.upsert({
    where: { source_label: { source: "google", label: email } },
    create: {
      source: "google",
      label: email,
      credentials: encrypt(JSON.stringify(creds)),
    },
    update: {
      credentials: encrypt(JSON.stringify(creds)),
    },
  });
  return account.id;
}

/** Pull calendar list for an account, upserting Calendar rows. */
export async function syncCalendars(accountId: string): Promise<number> {
  const auth = await clientForAccount(accountId);
  const cal = google.calendar({ version: "v3", auth });
  const items: calendar_v3.Schema$CalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.calendarList.list({ pageToken, maxResults: 250 });
    if (res.data.items) items.push(...res.data.items);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  for (const c of items) {
    if (!c.id) continue;
    await db.calendar.upsert({
      where: { accountId_sourceId: { accountId, sourceId: c.id } },
      create: {
        accountId,
        sourceId: c.id,
        name: c.summaryOverride ?? c.summary ?? c.id,
        color: c.backgroundColor ?? "#9aa0a6",
        isDefault: Boolean(c.primary),
      },
      update: {
        name: c.summaryOverride ?? c.summary ?? c.id,
        color: c.backgroundColor ?? "#9aa0a6",
        isDefault: Boolean(c.primary),
      },
    });
  }

  await db.account.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
  return items.length;
}

/** Pull events for all of this account's calendars in a window around now. */
export async function syncEvents(
  accountId: string,
  opts: { backDays?: number; forwardDays?: number } = {},
): Promise<number> {
  const backDays = opts.backDays ?? 30;
  const forwardDays = opts.forwardDays ?? 90;
  const timeMin = new Date(Date.now() - backDays * 86400_000).toISOString();
  const timeMax = new Date(Date.now() + forwardDays * 86400_000).toISOString();

  const auth = await clientForAccount(accountId);
  const cal = google.calendar({ version: "v3", auth });
  const calendars = await db.calendar.findMany({ where: { accountId } });

  let total = 0;
  for (const c of calendars) {
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const res = await cal.events.list({
        calendarId: c.sourceId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
        pageToken,
      });
      if (res.data.items) items.push(...res.data.items);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    for (const ev of items) {
      if (!ev.id) continue;
      if (ev.status === "cancelled") {
        await db.event
          .delete({ where: { calendarId_sourceId: { calendarId: c.id, sourceId: ev.id } } })
          .catch(() => {});
        continue;
      }
      const allDay = Boolean(ev.start?.date);
      const start = parseDate(ev.start);
      const end = parseDate(ev.end) ?? start;
      if (!start || !end) continue;
      await db.event.upsert({
        where: { calendarId_sourceId: { calendarId: c.id, sourceId: ev.id } },
        create: {
          calendarId: c.id,
          sourceId: ev.id,
          title: ev.summary ?? "(untitled)",
          start,
          end,
          allDay,
          notes: ev.description ?? null,
          kind: "event",
          raw: JSON.stringify(ev),
        },
        update: {
          title: ev.summary ?? "(untitled)",
          start,
          end,
          allDay,
          notes: ev.description ?? null,
          raw: JSON.stringify(ev),
        },
      });
    }
    total += items.length;
  }

  await db.account.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
  return total;
}

function parseDate(d?: calendar_v3.Schema$EventDateTime | null): Date | null {
  if (!d) return null;
  if (d.dateTime) return new Date(d.dateTime);
  if (d.date) return new Date(d.date + "T00:00:00");
  return null;
}

export async function pull(accountId: string): Promise<{ calendars: number; events: number }> {
  const calendars = await syncCalendars(accountId);
  const events = await syncEvents(accountId);
  return { calendars, events };
}

// ── Writeback ──────────────────────────────────────────────────────────────

type EventInput = {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  notes?: string | null;
};

function toGEventBody(input: EventInput): calendar_v3.Schema$Event {
  if (input.allDay) {
    const startStr = input.start.toISOString().slice(0, 10);
    const endStr = new Date(input.end.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      summary: input.title,
      description: input.notes ?? undefined,
      start: { date: startStr },
      end: { date: endStr },
    };
  }
  return {
    summary: input.title,
    description: input.notes ?? undefined,
    start: { dateTime: input.start.toISOString() },
    end: { dateTime: input.end.toISOString() },
  };
}

export async function createEvent(calendarRowId: string, input: EventInput): Promise<string> {
  const cal = await db.calendar.findUnique({
    where: { id: calendarRowId },
    include: { account: true },
  });
  if (!cal) throw new Error("Calendar not found");
  const auth = await clientForAccount(cal.accountId);
  const api = google.calendar({ version: "v3", auth });
  const res = await api.events.insert({
    calendarId: cal.sourceId,
    requestBody: toGEventBody(input),
  });
  if (!res.data.id) throw new Error("Google did not return an id");
  await db.event.create({
    data: {
      calendarId: cal.id,
      sourceId: res.data.id,
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: Boolean(input.allDay),
      notes: input.notes ?? null,
      kind: "event",
      raw: JSON.stringify(res.data),
    },
  });
  return res.data.id;
}

export async function updateEvent(eventRowId: string, input: Partial<EventInput>): Promise<void> {
  const ev = await db.event.findUnique({
    where: { id: eventRowId },
    include: { calendar: { include: { account: true } } },
  });
  if (!ev) throw new Error("Event not found");
  const cal = ev.calendar;
  const auth = await clientForAccount(cal.accountId);
  const api = google.calendar({ version: "v3", auth });
  const merged: EventInput = {
    title: input.title ?? ev.title,
    start: input.start ?? ev.start,
    end: input.end ?? ev.end,
    allDay: input.allDay ?? ev.allDay,
    notes: input.notes ?? ev.notes,
  };
  const res = await api.events.patch({
    calendarId: cal.sourceId,
    eventId: ev.sourceId,
    requestBody: toGEventBody(merged),
  });
  await db.event.update({
    where: { id: eventRowId },
    data: {
      title: merged.title,
      start: merged.start,
      end: merged.end,
      allDay: Boolean(merged.allDay),
      notes: merged.notes ?? null,
      raw: JSON.stringify(res.data),
    },
  });
}

export async function deleteEvent(eventRowId: string): Promise<void> {
  const ev = await db.event.findUnique({
    where: { id: eventRowId },
    include: { calendar: true },
  });
  if (!ev) return;
  const auth = await clientForAccount(ev.calendar.accountId);
  const api = google.calendar({ version: "v3", auth });
  await api.events.delete({ calendarId: ev.calendar.sourceId, eventId: ev.sourceId });
  await db.event.delete({ where: { id: eventRowId } }).catch(() => {});
}
