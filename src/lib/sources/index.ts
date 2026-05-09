import { db } from "@/lib/db";
import * as google from "@/lib/sources/google";
import * as notion from "@/lib/sources/notion";

type EventInput = {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  notes?: string | null;
};

function localId(): string {
  return "local-" + Math.random().toString(36).slice(2, 12) + "-" + Date.now().toString(36);
}

export async function createEvent(calendarId: string, input: EventInput): Promise<string> {
  const cal = await db.calendar.findUnique({
    where: { id: calendarId },
    include: { account: true },
  });
  if (!cal) throw new Error("Calendar not found");

  if (cal.account.source === "google") return google.createEvent(calendarId, input);

  // Local-only sources: notion-mcp categories, and Apple calendars (write-back not implemented,
  // but locally-added items are allowed and preserved across sync).
  if (cal.account.source === "notion-mcp" || cal.account.source === "apple") {
    const ev = await db.event.create({
      data: {
        calendarId,
        sourceId: localId(),
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: Boolean(input.allDay),
        notes: input.notes ?? null,
        kind: "task", // marks it as locally-added so Apple sync skips it on cleanup
      },
    });
    return ev.id;
  }

  if (cal.account.source === "notion")
    throw new Error("Creating Notion pages from the calendar isn't supported yet");
  throw new Error(`Unknown source ${cal.account.source}`);
}

export async function updateEvent(
  eventId: string,
  input: Partial<EventInput> & { calendarId?: string },
): Promise<void> {
  const ev = await db.event.findUnique({
    where: { id: eventId },
    include: { calendar: { include: { account: true } } },
  });
  if (!ev) throw new Error("Event not found");

  // Cross-calendar moves (changing category). Only applies when the user
  // picked a different calendarId. Currently only local↔local moves; Google
  // events stay where they are because the Google API needs a different code
  // path (events.move) and we don't want to silently lose data.
  if (input.calendarId && input.calendarId !== ev.calendarId) {
    if (ev.calendar.account.source === "google") {
      throw new Error("Moving Google events between calendars isn't supported yet — edit in google.com/calendar.");
    }
    const target = await db.calendar.findUnique({
      where: { id: input.calendarId },
      include: { account: true },
    });
    if (!target) throw new Error("Target calendar not found");
    if (target.account.source !== "notion-mcp") {
      throw new Error("Can only move events into local categories");
    }
    await db.event.update({
      where: { id: eventId },
      data: { calendarId: input.calendarId },
    });
    // Fall through so any other field changes (title/start/end/notes) also apply.
  }

  if (ev.calendar.account.source === "google") return google.updateEvent(eventId, input);

  if (ev.calendar.account.source === "notion") {
    if (!input.start || !input.end) throw new Error("Notion update requires start and end");
    return notion.updateEventDate(eventId, {
      start: input.start,
      end: input.end,
      allDay: Boolean(input.allDay ?? ev.allDay),
    });
  }

  // Local-only update: notion-mcp + locally-added Apple events.
  if (ev.calendar.account.source === "notion-mcp" || ev.calendar.account.source === "apple") {
    if (ev.calendar.account.source === "apple" && ev.kind !== "task") {
      // synced Apple event — read-only
      throw new Error("Apple Calendar writes aren't supported yet");
    }
    await db.event.update({
      where: { id: eventId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.start ? { start: input.start } : {}),
        ...(input.end ? { end: input.end } : {}),
        ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return;
  }

  throw new Error(`Updates not supported for ${ev.calendar.account.source}`);
}

export async function deleteEvent(eventId: string): Promise<void> {
  const ev = await db.event.findUnique({
    where: { id: eventId },
    include: { calendar: { include: { account: true } } },
  });
  if (!ev) return;
  if (ev.calendar.account.source === "google") return google.deleteEvent(eventId);
  if (ev.calendar.account.source === "notion") return notion.archiveEvent(eventId);
  if (ev.calendar.account.source === "notion-mcp" ||
      (ev.calendar.account.source === "apple" && ev.kind === "task")) {
    await db.event.delete({ where: { id: eventId } });
    return;
  }
  throw new Error(`Deletes not supported for ${ev.calendar.account.source}`);
}

export function isWritable(source: string): boolean {
  return source === "google" || source === "notion" || source === "notion-mcp";
}
