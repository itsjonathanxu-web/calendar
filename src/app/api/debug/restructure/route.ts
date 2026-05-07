import { db } from "@/lib/db";

// One-shot restructure for the new SCHEDULING / TASKS sidebar layout:
//
//   1. Delete the Notion account entirely (already detached via import-tasks-and-detach;
//      the sidebar shouldn't show "Notion" anymore).
//   2. Delete the old hardcoded notion-mcp buckets (Shai Research, Toronto Cinematic,
//      Chinese Learning, the legacy Notion Tasks bucket). Keep "📋 Tasks" — that's the
//      live import target.
//   3. Set Calendar.section = "tasks" on the imported "📋 Tasks" calendar (and any
//      other calendar under the "Imported Tasks" notion-mcp account).
//   4. Set Calendar.section = "scheduling" on everything else (this is the default but
//      we set it explicitly in case the migration adds new fields without backfilling).
async function run() {
  const notionAcct = await db.account.findFirst({ where: { source: "notion" } });
  let notionAccountDeleted = false;
  if (notionAcct) {
    await db.account.delete({ where: { id: notionAcct.id } });
    notionAccountDeleted = true;
  }

  // Delete old hardcoded notion-mcp buckets — anything that ISN'T the "Imported Tasks" account
  const importedAcct = await db.account.findFirst({
    where: { source: "notion-mcp", label: "Imported Tasks" },
  });
  let oldBucketsDeleted = 0;
  const otherMcpAccounts = await db.account.findMany({
    where: {
      source: "notion-mcp",
      ...(importedAcct ? { NOT: { id: importedAcct.id } } : {}),
    },
  });
  for (const a of otherMcpAccounts) {
    await db.account.delete({ where: { id: a.id } });
    oldBucketsDeleted += 1;
  }

  // Section assignment
  let scheduling = 0;
  let tasks = 0;
  if (importedAcct) {
    const result = await db.calendar.updateMany({
      where: { accountId: importedAcct.id },
      data: { section: "tasks", enabled: true },
    });
    tasks = result.count;
  }
  // Default everything else to "scheduling" (overwrites any prior value)
  const everyone = await db.calendar.updateMany({
    where: importedAcct ? { NOT: { accountId: importedAcct.id } } : {},
    data: { section: "scheduling" },
  });
  scheduling = everyone.count;

  return { notionAccountDeleted, oldBucketsDeleted, scheduling, tasks };
}

export async function POST() {
  const result = await run();
  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const result = await run();
  const url = new URL("/calendar", request.url);
  url.searchParams.set("restructured", JSON.stringify(result));
  return Response.redirect(url, 303);
}
