import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const enabled = form.get("remindersEnabled") === "true";
  const leadMin = Number(form.get("reminderLeadMin") ?? 15);
  await db.settings.upsert({
    where: { id: "settings" },
    create: {
      id: "settings",
      remindersEnabled: enabled,
      reminderLeadMin: Number.isFinite(leadMin) ? Math.max(1, Math.min(120, leadMin)) : 15,
    },
    update: {
      remindersEnabled: enabled,
      reminderLeadMin: Number.isFinite(leadMin) ? Math.max(1, Math.min(120, leadMin)) : 15,
    },
  });
  return NextResponse.json({ ok: true });
}
