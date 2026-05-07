import { NextResponse } from "next/server";
import { updateEvent } from "@/lib/sources";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { id, title, start, end, allDay, notes } = body as {
    id?: string;
    title?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    notes?: string | null;
  };
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  try {
    await updateEvent(id, {
      ...(title !== undefined ? { title } : {}),
      ...(start ? { start: new Date(start) } : {}),
      ...(end ? { end: new Date(end) } : {}),
      ...(allDay !== undefined ? { allDay } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("update event failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update_failed" },
      { status: 500 },
    );
  }
}
