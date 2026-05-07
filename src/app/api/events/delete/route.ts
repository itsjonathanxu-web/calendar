import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteEvent } from "@/lib/sources";
import { isInstanceId, parseInstanceId } from "@/lib/calendar/recurrence";

type Scope = "this" | "future" | "all";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { id, scope } = body as { id?: string; scope?: Scope };
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  // Synthetic recurring instance
  if (isInstanceId(id)) {
    const parsed = parseInstanceId(id);
    if (!parsed) return NextResponse.json({ error: "bad_instance_id" }, { status: 400 });
    return handleRecurringDelete(parsed.masterId, parsed.occurrence, scope ?? "this");
  }

  // Master with rrule
  const ev = await db.event.findUnique({ where: { id } });
  if (ev?.rrule) {
    return handleRecurringDelete(id, ev.start, scope ?? "all");
  }

  try {
    await deleteEvent(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete event failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete_failed" },
      { status: 500 },
    );
  }
}

async function handleRecurringDelete(masterId: string, occurrence: Date, scope: Scope) {
  const master = await db.event.findUnique({ where: { id: masterId } });
  if (!master) return NextResponse.json({ error: "master_not_found" }, { status: 404 });

  if (scope === "all") {
    // cascade kills all overrides because of the FK relation
    await db.event.delete({ where: { id: masterId } });
    return NextResponse.json({ ok: true, scope: "all" });
  }

  if (scope === "this") {
    // "Skipped" override — recorded as a 0-length event with kind="skipped".
    // The expansion logic skips dates that have an override of any kind.
    await db.event.deleteMany({
      where: { recurrenceParentId: masterId, start: occurrence },
    });
    await db.event.create({
      data: {
        calendarId: master.calendarId,
        sourceId: `${master.sourceId}-skip-${occurrence.toISOString()}`,
        title: "(deleted)",
        start: occurrence,
        end: occurrence,
        allDay: master.allDay,
        kind: "skipped",
        recurrenceParentId: masterId,
      },
    });
    return NextResponse.json({ ok: true, scope: "this" });
  }

  if (scope === "future") {
    // Truncate master's rrule with UNTIL just before this occurrence
    const untilDt = new Date(occurrence.getTime() - 1000);
    const untilStr = untilDt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const truncatedRRule = stripUntil(master.rrule ?? "") + `;UNTIL=${untilStr}`;
    await db.event.update({
      where: { id: masterId },
      data: { rrule: truncatedRRule },
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
