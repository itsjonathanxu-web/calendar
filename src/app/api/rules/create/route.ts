import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const text = String(form.get("text") ?? "").trim();
  const priority = Number(form.get("priority") ?? 50);
  if (text) {
    await db.rule.create({
      data: { text, priority: Number.isFinite(priority) ? priority : 50 },
    });
  }
  return NextResponse.redirect(new URL("/settings", request.url), { status: 303 });
}
