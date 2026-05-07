import { db } from "@/lib/db";
import { sendPushToAll } from "@/lib/push";
import { format } from "date-fns";
import { snapshotDb } from "@/lib/backup";

const TICK_MS = 60_000; // every minute
const BACKUP_INTERVAL_MS = 24 * 60 * 60_000; // daily
let started = false;

export function startCron() {
  if (started) return;
  started = true;
  console.log("[cron] starting reminder loop");
  // On boot: detect and replay any missed window before resuming the regular cadence.
  bootReplay()
    .catch((err) => console.error("[cron] boot replay error:", err))
    .finally(() => {
      runTick().catch((err) => console.error("[cron] tick error:", err));
      setInterval(() => {
        runTick().catch((err) => console.error("[cron] tick error:", err));
      }, TICK_MS);
    });
}

async function bootReplay() {
  // If the last "reminders" run was > 5 min ago, fire any reminders that came
  // due in the gap. This recovers from Fly machine suspends/restarts where the
  // setInterval timer doesn't survive.
  const last = await db.jobRun.findUnique({ where: { kind: "reminders" } });
  if (!last) return;
  const now = new Date();
  const gapMs = now.getTime() - last.lastRunAt.getTime();
  if (gapMs < 5 * 60_000) return;
  const gapMin = Math.round(gapMs / 60_000);
  console.log(`[cron] boot: ${gapMin}m gap detected, replaying missed reminders`);
  // Use the gap as a leadMin so anything that came due in the missed window
  // gets caught even if it was scheduled to fire 30+ min ago.
  await fireEventReminders(last.lastRunAt, Math.min(180, gapMin));
  await fireStandaloneReminders(now);
}

async function recordRun(kind: string, error?: unknown): Promise<void> {
  await db.jobRun.upsert({
    where: { kind },
    create: {
      kind,
      lastRunAt: new Date(),
      lastError: error ? String(error) : null,
    },
    update: {
      lastRunAt: new Date(),
      lastError: error ? String(error) : null,
    },
  });
}

async function runTick() {
  const now = new Date();
  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  if (settings && !settings.remindersEnabled) {
    await recordRun("reminders");
    return;
  }
  const lead = settings?.reminderLeadMin ?? 15;

  try {
    await fireEventReminders(now, lead);
    await fireStandaloneReminders(now);
    await recordRun("reminders");
  } catch (err) {
    console.error("[cron] tick failed:", err);
    await recordRun("reminders", err);
  }

  // Daily backup — fires whenever last backup is older than the interval
  const lastBackup = await db.jobRun.findUnique({ where: { kind: "backup" } });
  if (!lastBackup || now.getTime() - lastBackup.lastRunAt.getTime() > BACKUP_INTERVAL_MS) {
    try {
      await snapshotDb();
      await recordRun("backup");
    } catch (err) {
      console.error("[cron] backup failed:", err);
      await recordRun("backup", err);
    }
  }
}

async function fireEventReminders(now: Date, leadMin: number) {
  // Fire when an event starts within [now, now + leadMin + 1 minute) AND we haven't notified for it yet.
  const windowEnd = new Date(now.getTime() + (leadMin + 1) * 60_000);
  const events = await db.event.findMany({
    where: {
      start: { gte: now, lt: windowEnd },
      notifiedAt: null,
      allDay: false, // skip all-day items — too noisy
      calendar: { enabled: true },
    },
    include: { calendar: true },
    take: 50,
  });

  for (const ev of events) {
    const minsAway = Math.max(0, Math.round((ev.start.getTime() - now.getTime()) / 60_000));
    try {
      const result = await sendPushToAll({
        title: minsAway === 0 ? `Now: ${ev.title}` : `In ${minsAway}m: ${ev.title}`,
        body: `${format(ev.start, "h:mm a")} – ${format(ev.end, "h:mm a")} · ${ev.calendar.name}`,
        url: "/calendar",
        tag: `event-${ev.id}`,
      });
      console.log(`[cron] notified event "${ev.title}" → sent=${result.sent} pruned=${result.pruned}`);
      await db.event.update({ where: { id: ev.id }, data: { notifiedAt: now } });
    } catch (err) {
      console.error(`[cron] notify failed for event ${ev.id}:`, err);
    }
  }
}

async function fireStandaloneReminders(now: Date) {
  // Phase 1: only fire one-shot reminders that haven't been fired yet.
  // Recurring reminder rrule advancement comes in a follow-up.
  const reminders = await db.reminder.findMany({
    where: {
      enabled: true,
      dueAt: { lte: now },
      lastFiredAt: null,
    },
    take: 20,
  });

  for (const r of reminders) {
    try {
      await sendPushToAll({
        title: r.title,
        body: r.notes ?? "Reminder",
        url: "/calendar",
        tag: `reminder-${r.id}`,
      });
      await db.reminder.update({
        where: { id: r.id },
        data: { lastFiredAt: now },
      });
      // For non-recurring reminders, disable after firing so they don't repeat.
      if (!r.rrule) {
        await db.reminder.update({ where: { id: r.id }, data: { enabled: false } });
      }
      // (Recurring rrule advancement comes in a later step.)
    } catch (err) {
      console.error(`[cron] reminder ${r.id} failed:`, err);
    }
  }
}
