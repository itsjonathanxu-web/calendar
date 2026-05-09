import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updateEvent } from "@/lib/sources";
import { isInstanceId, parseInstanceId } from "@/lib/calendar/recurrence";

type Scope = "this" | "future" | "all";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { id, title, start, end, allDay, notes, rrule, scope, calendarId } = body as {
    id?: string;
    title?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    notes?: string | null;
    rrule?: string | null;
    scope?: Scope;
    calendarId?: string;
  };
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  // Trace what's coming in so we can pin down the recurring "notes don't save" reports.
  if (notes !== undefined) {
    console.log(
      `[events/update] id=${id} scope=${scope ?? "(default)"} notes=${JSON.stringify(notes)?.slice(0, 80)} title=${title ? "set" : "skip"} cal=${calendarId ? "set" : "skip"}`,
    );
  }

  // Recurring instance — id looks like "masterId::ISO"
  if (isInstanceId(id)) {
    const parsed = parseInstanceId(id);
    if (!parsed) return NextResponse.json({ error: "bad_instance_id" }, { status: 400 });
    return handleRecurringUpdate(parsed.masterId, parsed.occurrence, scope ?? "this", {
      title, start, end, allDay, notes, rrule, calendarId,
    });
  }

  // Direct master update — also goes through the scope logic if rrule present
  const ev = await db.event.findUnique({ where: { id } });
  if (ev?.rrule) {
    return handleRecurringUpdate(id, ev.start, scope ?? "all", {
      title, start, end, allDay, notes, rrule, calendarId,
    });
  }

  // Regular event — pass through to source dispatcher
  try {
    await updateEvent(id, {
      ...(title !== undefined ? { title } : {}),
      ...(start ? { start: new Date(start) } : {}),
      ...(end ? { end: new Date(end) } : {}),
      ...(allDay !== undefined ? { allDay } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(calendarId ? { calendarId } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("update event failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update_failed" },
      { status: 500 },
    );
  }
}

async function handleRecurringUpdate(
  masterId: string,
  occurrence: Date,
  scope: Scope,
  patch: {
    title?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    notes?: string | null;
    rrule?: string | null;
    calendarId?: string;
  },
) {
  const master = await db.event.findUnique({
    where: { id: masterId },
    include: { calendar: { include: { account: true } } },
  });
  if (!master) return NextResponse.json({ error: "master_not_found" }, { status: 404 });
  if (master.calendar.account.source !== "notion-mcp" && master.calendar.account.source !== "apple") {
    return NextResponse.json(
      { error: "Recurring edits only supported on local calendars" },
      { status: 400 },
    );
  }

  const newStart = patch.start ? new Date(patch.start) : null;
  const newEnd = patch.end ? new Date(patch.end) : null;

  if (scope === "all") {
    // Update master directly. Times stay relative to its original start unless explicitly set.
    await db.event.update({
      where: { id: masterId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(newStart ? { start: newStart } : {}),
        ...(newEnd ? { end: newEnd } : {}),
        ...(patch.allDay !== undefined ? { allDay: patch.allDay } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.rrule !== undefined ? { rrule: patch.rrule } : {}),
        ...(patch.calendarId ? { calendarId: patch.calendarId } : {}),
      },
    });
    return NextResponse.json({ ok: true, scope: "all" });
  }

  if (scope === "this") {
    // Create an override Event for this single occurrence — same calendar, recurrenceParentId=master.
    const dur = (newEnd ?? master.end).getTime() - (newStart ?? master.start).getTime();
    const overrideStart = newStart ?? occurrence;
    const overrideEnd = newEnd ?? new Date(occurrence.getTime() + (master.end.getTime() - master.start.getTime()));
    // Replace any existing override for this occurrence
    await db.event.deleteMany({
      where: { recurrenceParentId: masterId, start: occurrence },
    });
    await db.event.create({
      data: {
        calendarId: master.calendarId,
        sourceId: `${master.sourceId}-override-${occurrence.toISOString()}`,
        title: patch.title ?? master.title,
        start: overrideStart,
        end: dur > 0 ? overrideEnd : new Date(overrideStart.getTime() + 60 * 60_000),
        allDay: patch.allDay ?? master.allDay,
        notes: patch.notes !== undefined ? patch.notes : master.notes,
        kind: master.kind,
        recurrenceParentId: masterId,
      },
    });
    return NextResponse.json({ ok: true, scope: "this" });
  }

  if (scope === "future") {
    // Truncate the master's rrule with UNTIL just before this occurrence,
    // then create a new master starting at this occurrence with the same rrule.
    const untilDt = new Date(occurrence.getTime() - 1000);
    const untilStr = untilDt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const truncatedRRule = stripUntil(master.rrule ?? "") + `;UNTIL=${untilStr}`;
    await db.event.update({
      where: { id: masterId },
      data: { rrule: truncatedRRule },
    });
    const dur = master.end.getTime() - master.start.getTime();
    const newMasterStart = newStart ?? occurrence;
    const newMasterEnd = newEnd ?? new Date(newMasterStart.getTime() + dur);
    await db.event.create({
      data: {
        calendarId: master.calendarId,
        sourceId: `${master.sourceId}-split-${occurrence.toISOString()}`,
        title: patch.title ?? master.title,
        start: newMasterStart,
        end: newMasterEnd,
        allDay: patch.allDay ?? master.allDay,
        notes: patch.notes !== undefined ? patch.notes : master.notes,
        kind: master.kind,
        rrule: patch.rrule !== undefined ? patch.rrule : master.rrule,
      },
    });
    return NextResponse.json({ ok: true, scope: "future" });
  }

  return NextResponse.json({ error: "unknown_scope" }, { status: 400 });
}

function stripUntil(rrule: string): string {
  return rrule
    .split(";")
    .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
    .join(";");
}
