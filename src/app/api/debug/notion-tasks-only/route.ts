import { db } from "@/lib/db";

// Disable every Notion-sourced calendar except the one literally named "Tasks".
// Also disables the hardcoded notion-mcp buckets so the user sees just the real
// Tasks DB on the calendar.
async function run() {
  const disabledOthers = await db.calendar.updateMany({
    where: {
      account: { source: "notion" },
      NOT: { name: "Tasks" },
    },
    data: { enabled: false },
  });
  const enabledTasks = await db.calendar.updateMany({
    where: { account: { source: "notion" }, name: "Tasks" },
    data: { enabled: true },
  });
  const disabledMcp = await db.calendar.updateMany({
    where: { account: { source: "notion-mcp" } },
    data: { enabled: false },
  });
  return {
    disabledOthers: disabledOthers.count,
    enabledTasks: enabledTasks.count,
    disabledMcp: disabledMcp.count,
  };
}

export async function POST() {
  const result = await run();
  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const result = await run();
  const url = new URL("/calendar", request.url);
  url.searchParams.set(
    "filtered",
    `${result.enabledTasks} Tasks kept · ${result.disabledOthers + result.disabledMcp} hidden`,
  );
  return Response.redirect(url, 303);
}
