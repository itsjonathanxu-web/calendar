"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { snapshotDb } from "@/lib/backup";
import { pull as pullApple } from "@/lib/sources/apple";
import { SEED_TASKS } from "@/app/api/debug/seed-tasks-manual/data";

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

export async function wipeAndResyncApple(): Promise<{ ok: boolean; message: string }> {
  const accounts = await db.account.findMany({ where: { source: "apple" } });
  if (accounts.length === 0) return { ok: false, message: "No Apple account connected" };
  let deleted = 0;
  let pulled = 0;
  for (const account of accounts) {
    const cals = await db.calendar.findMany({ where: { accountId: account.id } });
    for (const cal of cals) {
      const res = await db.event.deleteMany({ where: { calendarId: cal.id, kind: "event" } });
      deleted += res.count;
    }
    const result = await pullApple(account.id);
    pulled += result.events;
  }
  revalidatePath("/calendar");
  revalidatePath("/admin");
  return { ok: true, message: `Deleted ${deleted} stale rows, re-pulled ${pulled}` };
}

export async function runBackupNow(): Promise<{ ok: boolean; message: string }> {
  const result = await snapshotDb();
  revalidatePath("/admin");
  if (!result) return { ok: false, message: "Backup skipped (db not found)" };
  return { ok: true, message: `Snapshot ${(result.bytes / 1024).toFixed(1)} KB → ${result.path}` };
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
