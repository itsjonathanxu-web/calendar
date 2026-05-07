import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const {
    name,
    color,
    mode,
    target,
    matchCalendars,
    matchTitles,
  } = body as {
    name?: string;
    color?: string;
    mode?: "count" | "hours" | "daily";
    target?: number;
    matchCalendars?: string[];
    matchTitles?: string[];
  };
  if (!name?.trim()) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!mode || !["count", "hours", "daily"].includes(mode))
    return NextResponse.json({ error: "bad_mode" }, { status: 400 });
  const tgt = typeof target === "number" && target > 0 ? target : 1;
  const goal = await db.progressGoal.create({
    data: {
      name: name.trim(),
      color: color ?? "#7c7c7c",
      mode,
      target: tgt,
      matchCalendars: matchCalendars?.length ? matchCalendars.join(",") : null,
      matchTitles: matchTitles?.length ? matchTitles.map((t) => t.trim()).filter(Boolean).join(",") : null,
    },
  });
  return NextResponse.json({ ok: true, goal });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = (body.id as string | undefined) ?? "";
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await db.progressGoal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
