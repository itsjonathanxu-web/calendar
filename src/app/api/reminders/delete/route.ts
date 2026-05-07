import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await db.reminder.delete({ where: { id: body.id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
