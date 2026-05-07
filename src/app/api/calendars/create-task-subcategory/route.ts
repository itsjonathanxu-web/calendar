import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Create a new task subcategory (Calendar) under the local "Imported Tasks" account.
// Used by the FilterSidebar's + button next to the TASKS section header.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = (body.name as string | undefined)?.trim();
  const color = (body.color as string | undefined) ?? "#7c7c7c";
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

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

  const sourceId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const cal = await db.calendar.create({
    data: {
      accountId: acct.id,
      sourceId,
      name,
      color,
      enabled: true,
      section: "tasks",
      config: JSON.stringify({ sortOrder: 50 }),
    },
  });
  return NextResponse.json({ ok: true, calendar: { id: cal.id, name: cal.name, color: cal.color } });
}
