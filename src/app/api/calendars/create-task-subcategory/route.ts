import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Create a new local category. Used by the FilterSidebar's + buttons next to
// the SCHEDULING and TASKS section headers. Section can be "scheduling" or
// "tasks" — picks the right local Account so it groups under the right header.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = (body.name as string | undefined)?.trim();
  const color = (body.color as string | undefined) ?? "#7c7c7c";
  const section = body.section === "scheduling" ? "scheduling" : "tasks";
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  const accountLabel = section === "scheduling" ? "Local Calendars" : "Imported Tasks";
  const acct = await db.account.upsert({
    where: { source_label: { source: "notion-mcp", label: accountLabel } },
    create: {
      source: "notion-mcp",
      label: accountLabel,
      credentials: "{}",
      lastSyncAt: new Date(),
    },
    update: {},
  });

  const sourceId = `${section}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const cal = await db.calendar.create({
    data: {
      accountId: acct.id,
      sourceId,
      name,
      color,
      enabled: true,
      section,
      config: JSON.stringify({ sortOrder: 50 }),
    },
  });
  return NextResponse.json({ ok: true, calendar: { id: cal.id, name: cal.name, color: cal.color } });
}
