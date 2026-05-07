import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const start = String(form.get("workdayStart") ?? "09:00");
  const end = String(form.get("workdayEnd") ?? "18:00");
  const tz = String(form.get("timezone") ?? "America/Toronto");
  await db.settings.upsert({
    where: { id: "settings" },
    create: { id: "settings", workdayStart: start, workdayEnd: end, timezone: tz },
    update: { workdayStart: start, workdayEnd: end, timezone: tz },
  });
  return NextResponse.redirect(new URL("/settings", request.url), { status: 303 });
}
