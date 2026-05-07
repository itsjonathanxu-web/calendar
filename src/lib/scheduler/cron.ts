import { db } from "@/lib/db";
import { sendPushToAll } from "@/lib/push";
import { format } from "date-fns";

const TICK_MS = 60_000; // every minute
let started = false;

export function startCron() {
  if (started) return;
  started = true;
  console.log("[cron] starting reminder loop");
  // Run once immediately, then on every tick.
  runTick().catch((err) => console.error("[cron] tick error:", err));
  setInterval(() => {
    runTick().catch((err) => console.error("[cron] tick error:", err));
  }, TICK_MS);
}

async function runTick() {
  const now = new Date();
  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  if (settings && !settings.remindersEnabled) return;
  const lead = settings?.reminderLeadMin ?? 15;

  await fireEventReminders(now, lead);
  await fireStandaloneReminders(now);
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
