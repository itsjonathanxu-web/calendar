import { NextResponse } from "next/server";
import { deleteEvent } from "@/lib/sources";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { id } = body as { id?: string };
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  try {
    await deleteEvent(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete event failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete_failed" },
      { status: 500 },
    );
  }
}
