import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Update name / color / section / sortOrder for a single calendar. Used by
// the sidebar's edit dialog. Cross-section moves change which header the
// calendar appears under (Scheduling vs Tasks).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const data: {
    name?: string;
    color?: string;
    section?: string;
    config?: string;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.color === "string") data.color = body.color;
  if (body.section === "scheduling" || body.section === "tasks") data.section = body.section;

  // sortOrder is stored inside the config JSON blob.
  if (typeof body.sortOrder === "number") {
    const cur = await db.calendar.findUnique({ where: { id } });
    if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });
    let cfg: { sortOrder?: number } = {};
    try {
      cfg = cur.config ? JSON.parse(cur.config) : {};
    } catch {
      cfg = {};
    }
    cfg.sortOrder = body.sortOrder;
    data.config = JSON.stringify(cfg);
  }

  const updated = await db.calendar.update({ where: { id }, data });
  return NextResponse.json({
    ok: true,
    calendar: {
      id: updated.id,
      name: updated.name,
      color: updated.color,
      section: (updated as unknown as { section?: string }).section ?? "scheduling",
    },
  });
}
