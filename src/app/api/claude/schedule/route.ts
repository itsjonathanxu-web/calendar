import { NextResponse } from "next/server";
import { chat } from "@/lib/scheduler/claude";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { message } = body as { message?: string };
  if (!message || !message.trim()) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }
  try {
    const turn = await chat(message.trim());
    return NextResponse.json({ ok: true, ...turn });
  } catch (err) {
    console.error("claude schedule error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "claude_failed" },
      { status: 500 },
    );
  }
}
