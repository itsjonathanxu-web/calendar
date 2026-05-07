import { NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/push";

export async function POST() {
  try {
    const result = await sendPushToAll({
      title: "📅 Calendar test",
      body: "Notifications are wired up. You'll see meeting reminders here.",
      url: "/calendar",
      tag: "calendar-test",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "push_failed" },
      { status: 500 },
    );
  }
}
