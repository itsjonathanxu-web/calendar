import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "1";
  if (id) await db.rule.update({ where: { id }, data: { active } }).catch(() => {});
  return NextResponse.redirect(new URL("/settings", request.url), { status: 303 });
}
