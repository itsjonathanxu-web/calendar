import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Toggle a task's "completed" state. Completion = move the event into a special
// "✓ Completed" calendar (auto-created on first use, default disabled in the
// FilterSidebar). Uncompletion = move it back to its original calendar.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = (body.id as string | undefined) ?? "";
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const ev = await db.event.findUnique({
    where: { id },
    include: { calendar: { include: { account: true } } },
  });
  if (!ev) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Find or create the Completed calendar — lives under the same notion-mcp
  // "Imported Tasks" account so it's part of the TASKS section.
  const acct = await db.account.upsert({
    where: { source_label: { source: "notion-mcp", label: "Imported Tasks" } },
    create: {
      source: "notion-mcp",
      label: "Imported Tasks",
      credentials: "{}",
      lastSyncAt: new Date(),
    },
    update: {},
  });
  const completedCal = await db.calendar.upsert({
    where: { accountId_sourceId: { accountId: acct.id, sourceId: "completed" } },
    create: {
      accountId: acct.id,
      sourceId: "completed",
      name: "✓ Completed",
      color: "#52525b",
      enabled: false, // auto-hidden — user can flip in sidebar
      section: "tasks",
      config: JSON.stringify({ sortOrder: 99 }),
    },
    update: {},
  });

  if (ev.calendarId === completedCal.id) {
    // Uncomplete: move back to original calendar (or to the Tasks calendar if original is gone)
    let targetId = ev.completedFromCalendarId;
    if (targetId) {
      const exists = await db.calendar.findUnique({ where: { id: targetId } });
      if (!exists) targetId = null;
    }
    if (!targetId) {
      const fallback = await db.calendar.findFirst({
        where: { accountId: acct.id, sourceId: "tasks" },
      });
      targetId = fallback?.id ?? null;
    }
    if (!targetId) {
      return NextResponse.json({ error: "no_target_calendar" }, { status: 500 });
    }
    await db.event.update({
      where: { id },
      data: { calendarId: targetId, completedFromCalendarId: null },
    });
    return NextResponse.json({ ok: true, completed: false });
  }

  // Complete: remember origin, move to completed calendar
  await db.event.update({
    where: { id },
    data: {
      completedFromCalendarId: ev.calendarId,
      calendarId: completedCal.id,
    },
  });
  return NextResponse.json({ ok: true, completed: true });
}
