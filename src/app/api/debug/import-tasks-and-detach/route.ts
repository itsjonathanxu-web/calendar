import { Client } from "@notionhq/client";
import { db } from "@/lib/db";
import { pull as pullNotion } from "@/lib/sources/notion";
import { decrypt } from "@/lib/crypto";

// Walk a page's top-level blocks and concatenate the plain_text. Skips deeply
// nested children (toggle contents, list-item bullets) — fine for short task notes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPageText(client: Client, pageId: string): Promise<string> {
  const lines: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const block of res.results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = block as any;
      const inner = b[b.type];
      if (!inner) continue;
      const arr = inner.rich_text;
      if (Array.isArray(arr)) {
        const text = arr
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r.plain_text ?? "")
          .join("")
          .trim();
        if (text) {
          // Prefix headings + bullets so the output reads as a doc
          if (b.type.startsWith("heading_")) lines.push(`\n${text}`);
          else if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") lines.push(`• ${text}`);
          else if (b.type === "to_do") {
            const checked = inner.checked ? "✓" : "☐";
            lines.push(`${checked} ${text}`);
          } else lines.push(text);
        }
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return lines.join("\n").trim();
}

// One-shot: pull the Notion Tasks DB once, migrate the events into a local
// notion-mcp calendar (so they're editable + don't get touched by future
// Notion syncs), and disable every Notion-sourced calendar so the cron stops
// pulling. After running this, "Tasks" lives entirely on this calendar; the
// user manages it via the +Event button and edits in place.
async function run() {
  const notionAcct = await db.account.findFirst({ where: { source: "notion" } });
  if (!notionAcct) return { error: "no_notion_account" };

  // Final sync to make sure every dated task is pulled
  try {
    await pullNotion(notionAcct.id);
  } catch (e) {
    console.error("[detach] final notion pull failed:", e);
  }

  const sourceCal = await db.calendar.findFirst({
    where: { accountId: notionAcct.id, name: "Tasks" },
  });
  if (!sourceCal) return { error: "no_tasks_calendar_after_sync" };

  // Local target lives under a notion-mcp account so it's writable + ignored by sync
  const mcpAcct = await db.account.upsert({
    where: { source_label: { source: "notion-mcp", label: "Imported Tasks" } },
    create: {
      source: "notion-mcp",
      label: "Imported Tasks",
      credentials: "{}",
      lastSyncAt: new Date(),
    },
    update: {},
  });

  const targetCal = await db.calendar.upsert({
    where: { accountId_sourceId: { accountId: mcpAcct.id, sourceId: "tasks" } },
    create: {
      accountId: mcpAcct.id,
      sourceId: "tasks",
      name: "📋 Tasks",
      color: sourceCal.color,
      enabled: true,
      config: JSON.stringify({ sortOrder: 0 }),
    },
    update: { color: sourceCal.color, enabled: true },
  });

  // Hydrate notes from each Notion page's body content before migrating.
  const token = JSON.parse(decrypt(notionAcct.credentials)).token as string;
  const client = new Client({ auth: token });
  const events = await db.event.findMany({ where: { calendarId: sourceCal.id } });
  let notesHydrated = 0;
  for (const ev of events) {
    try {
      const text = await getPageText(client, ev.sourceId);
      if (text) {
        await db.event.update({ where: { id: ev.id }, data: { notes: text } });
        notesHydrated += 1;
      }
    } catch (err) {
      console.warn(`[detach] failed to fetch notes for ${ev.title}:`, err);
    }
  }

  // Re-point existing events at the local calendar and mark as task (locally-editable)
  const migrated = await db.event.updateMany({
    where: { calendarId: sourceCal.id },
    data: { calendarId: targetCal.id, kind: "task" },
  });

  // Stop the cron from re-syncing — disable every calendar under the Notion account
  const disabled = await db.calendar.updateMany({
    where: { accountId: notionAcct.id },
    data: { enabled: false },
  });

  return {
    migrated: migrated.count,
    notesHydrated,
    disabledNotionCalendars: disabled.count,
    targetCalendar: targetCal.name,
  };
}

export async function POST() {
  const result = await run();
  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const result = await run();
  const url = new URL("/calendar", request.url);
  url.searchParams.set("imported", JSON.stringify(result));
  return Response.redirect(url, 303);
}
