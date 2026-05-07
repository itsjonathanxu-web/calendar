import { db } from "@/lib/db";
import { SEED_TASKS } from "./data";

// Recovery endpoint — seeds the local "📋 Tasks" calendar with every undone
// dated task fetched directly from the user's Notion DB at the time the
// data.ts file was generated. Idempotent: existing rows (matched by sourceId)
// are upserted, not duplicated.
async function run() {
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

  let inserted = 0;
  let updated = 0;
  for (const t of SEED_TASKS) {
    const start = new Date(t.start + "T00:00:00");
    const end = new Date(t.start + "T23:59:59");
    const existing = await db.event.findUnique({
      where: { calendarId_sourceId: { calendarId: cal.id, sourceId: t.uid } },
    });
    if (existing) {
      await db.event.update({
        where: { id: existing.id },
        data: { title: t.title, start, end, notes: t.notes || null, allDay: true, kind: "task" },
      });
      updated += 1;
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
      inserted += 1;
    }
  }
  return { inserted, updated, total: SEED_TASKS.length };
}

export async function POST() {
  const result = await run();
  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const result = await run();
  const url = new URL("/calendar", request.url);
  url.searchParams.set("seeded", JSON.stringify(result));
  return Response.redirect(url, 303);
}
