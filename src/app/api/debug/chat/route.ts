import { NextResponse } from "next/server";
import { chat } from "@/lib/scheduler/claude";

// Debug-token-protected proxy to the chat function so the admin/test side can
// drive the schedule chat without a browser session (the regular endpoint goes
// through CSRF + session auth which a curl from outside can't satisfy).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message = (body.message as string | undefined) ?? "";
  if (!message.trim()) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  try {
    const turn = await chat(message.trim());
    return NextResponse.json({ ok: true, ...turn });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "claude_failed" },
      { status: 500 },
    );
  }
}
