import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (id) await db.project.delete({ where: { id } }).catch(() => {});
  return NextResponse.redirect(new URL("/projects", request.url), { status: 303 });
}
