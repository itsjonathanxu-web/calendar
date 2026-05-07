import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.title || !body?.dueAt) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const reminder = await db.reminder.create({
    data: {
      title: String(body.title),
      dueAt: new Date(body.dueAt),
      notes: body.notes ?? null,
      rrule: body.rrule ?? null,
    },
  });
  return NextResponse.json({ ok: true, reminder });
}
