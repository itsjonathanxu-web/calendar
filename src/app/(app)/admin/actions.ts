"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { snapshotDb } from "@/lib/backup";
import { SEED_TASKS } from "@/app/api/debug/seed-tasks-manual/data";

const MAY_2026_LABEL = "Migrated from Apple (May 2026)";

const PROGRESS_PRESETS = [
  {
    name: "Fitness",
    color: "#22c55e",
    mode: "count",
    target: 6,
    matchTitles: "workout,swim,run,gym,fitness,push,pull,legs",
    sortOrder: 0,
  },
  {
    name: "SHAI Research",
    color: "#dc2626",
    mode: "hours",
    target: 4,
    matchTitles: "shai",
    sortOrder: 10,
  },
  {
    name: "Stretching",
    color: "#0ea5e9",
    mode: "daily",
    target: 7,
    matchTitles: "stretch,mobility",
    sortOrder: 20,
  },
];

export async function reseedTasks(): Promise<{ ok: boolean; message: string }> {
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
  const cal = await db.calendar.upsert({
    where: { accountId_sourceId: { accountId: acct.id, sourceId: "tasks" } },
    create: {
      accountId: acct.id,
      sourceId: "tasks",
      name: "📋 Tasks",
      color: "#7c7c7c",
      enabled: true,
      section: "tasks",
      config: JSON.stringify({ sortOrder: 0 }),
    },
    update: { enabled: true, section: "tasks" },
  });
  let inserted = 0,
    updated = 0;
  for (const t of SEED_TASKS) {
    const start = new Date(t.start + "T00:00:00.000Z");
    const end = new Date(start.getTime() + 86400_000 - 1);
    const existing = await db.event.findUnique({
      where: { calendarId_sourceId: { calendarId: cal.id, sourceId: t.uid } },
    });
    if (existing) {
      await db.event.update({
        where: { id: existing.id },
        data: { title: t.title, start, end, notes: t.notes || null, allDay: true, kind: "task" },
      });
      updated++;
    } else {
      await db.event.create({
        data: {
          calendarId: cal.id,
          sourceId: t.uid,
          title: t.title,
          start,
          end,
          allDay: true,
          notes: t.notes || null,
          kind: "task",
        },
      });
      inserted++;
    }
  }
  revalidatePath("/calendar");
  revalidatePath("/admin");
  return { ok: true, message: `${inserted} added, ${updated} updated (${SEED_TASKS.length} total)` };
}

export async function reseedProgress(): Promise<{ ok: boolean; message: string }> {
  let created = 0;
  for (const p of PROGRESS_PRESETS) {
    const existing = await db.progressGoal.findFirst({ where: { name: p.name } });
    if (existing) continue;
    await db.progressGoal.create({
      data: {
        name: p.name,
        color: p.color,
        mode: p.mode,
        target: p.target,
        matchTitles: p.matchTitles,
        sortOrder: p.sortOrder,
      },
    });
    created++;
  }
  revalidatePath("/progress");
  revalidatePath("/admin");
  return {
    ok: true,
    message: `${created} new goal${created === 1 ? "" : "s"} created (${PROGRESS_PRESETS.length - created} already existed)`,
  };
}

export async function runBackupNow(): Promise<{ ok: boolean; message: string }> {
  const result = await snapshotDb();
  revalidatePath("/admin");
  if (!result) return { ok: false, message: "Backup skipped (db not found)" };
  return { ok: true, message: `Snapshot ${(result.bytes / 1024).toFixed(1)} KB → ${result.path}` };
}

// One-time: copy every May 2026 Apple-sourced event into a parallel local
// account/calendar so we can disconnect iCloud without losing the month.
// Idempotent — re-running upserts by sourceId so duplicates don't pile up.
export async function migrateAppleMayToLocal(): Promise<{ ok: boolean; message: string }> {
  const appleAccounts = await db.account.findMany({ where: { source: "apple" } });
  if (appleAccounts.length === 0) {
    return { ok: false, message: "No Apple account connected" };
  }

  // May 2026, local-ish (the Apple events are stored as UTC instants from
  // CalDAV; "May 2026" here is intentionally a wide UTC window so EDT-evening
  // May-1 events on either edge come along).
  const monthStart = new Date(Date.UTC(2026, 4, 1, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(2026, 5, 1, 0, 0, 0));

  const localAccount = await db.account.upsert({
    where: { source_label: { source: "notion-mcp", label: MAY_2026_LABEL } },
    create: {
      source: "notion-mcp",
      label: MAY_2026_LABEL,
      credentials: "{}",
      lastSyncAt: new Date(),
    },
    update: {},
  });

  let copied = 0;
  let updated = 0;
  let calendarsTouched = 0;

  for (const acct of appleAccounts) {
    const appleCals = await db.calendar.findMany({ where: { accountId: acct.id } });
    for (const appleCal of appleCals) {
      // Only the events the user actually saw from iCloud — kind="event".
      // Locally-added Apple-calendar items (kind="task") are already in the DB
      // independent of CalDAV so they don't need migrating.
      const events = await db.event.findMany({
        where: {
          calendarId: appleCal.id,
          kind: "event",
          start: { gte: monthStart, lt: monthEnd },
        },
      });
      if (events.length === 0) continue;

      // Mirror each Apple calendar to a local twin (same name/color) so the
      // sidebar layout doesn't change visually.
      const twin = await db.calendar.upsert({
        where: {
          accountId_sourceId: {
            accountId: localAccount.id,
            sourceId: `apple-mirror::${appleCal.id}`,
          },
        },
        create: {
          accountId: localAccount.id,
          sourceId: `apple-mirror::${appleCal.id}`,
          name: appleCal.name,
          color: appleCal.color,
          enabled: true,
          section: "scheduling",
        },
        update: { name: appleCal.name, color: appleCal.color },
      });
      calendarsTouched += 1;

      for (const ev of events) {
        const sourceId = `apple-import::${ev.sourceId}`;
        const existing = await db.event.findUnique({
          where: { calendarId_sourceId: { calendarId: twin.id, sourceId } },
        });
        if (existing) {
          await db.event.update({
            where: { id: existing.id },
            data: {
              title: ev.title,
              start: ev.start,
              end: ev.end,
              allDay: ev.allDay,
              notes: ev.notes,
            },
          });
          updated += 1;
        } else {
          await db.event.create({
            data: {
              calendarId: twin.id,
              sourceId,
              title: ev.title,
              start: ev.start,
              end: ev.end,
              allDay: ev.allDay,
              notes: ev.notes,
              kind: "task", // local-only marker, prevents Apple resync from clobbering
            },
          });
          copied += 1;
        }
      }
    }
  }

  revalidatePath("/calendar");
  revalidatePath("/progress");
  revalidatePath("/admin");
  return {
    ok: true,
    message: `Mirrored ${calendarsTouched} calendar${calendarsTouched === 1 ? "" : "s"} · ${copied} new, ${updated} updated`,
  };
}

// One-shot: drop every Apple Account + its Calendars/Events. Run after the
// May-2026 migration above so the local twins are the only copy left.
export async function disconnectAppleEntirely(): Promise<{ ok: boolean; message: string }> {
  const appleAccounts = await db.account.findMany({ where: { source: "apple" } });
  if (appleAccounts.length === 0) {
    return { ok: false, message: "No Apple account to disconnect" };
  }
  let removedAccounts = 0;
  let removedEvents = 0;
  for (const acct of appleAccounts) {
    const cals = await db.calendar.findMany({ where: { accountId: acct.id } });
    for (const cal of cals) {
      const r = await db.event.deleteMany({ where: { calendarId: cal.id } });
      removedEvents += r.count;
    }
    await db.account.delete({ where: { id: acct.id } });
    removedAccounts += 1;
  }
  revalidatePath("/calendar");
  revalidatePath("/settings");
  revalidatePath("/admin");
  return {
    ok: true,
    message: `Removed ${removedAccounts} Apple account${removedAccounts === 1 ? "" : "s"} and ${removedEvents} synced event row${removedEvents === 1 ? "" : "s"}`,
  };
}

export async function deleteTaskCategory(calendarId: string): Promise<{ ok: boolean; message: string }> {
  const cal = await db.calendar.findUnique({
    where: { id: calendarId },
    include: { account: true, _count: { select: { events: true } } },
  });
  if (!cal) return { ok: false, message: "Not found" };
  if (cal.section !== "tasks") return { ok: false, message: "Only task categories can be deleted here" };
  if (cal.sourceId === "tasks" || cal.sourceId === "completed") {
    return { ok: false, message: "Built-in categories can't be deleted" };
  }
  await db.calendar.delete({ where: { id: calendarId } });
  revalidatePath("/admin");
  revalidatePath("/calendar");
  return { ok: true, message: `Deleted "${cal.name}" (${cal._count.events} events also removed)` };
}
