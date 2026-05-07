import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const dueRaw = String(form.get("dueDate") ?? "").trim();
  const color = String(form.get("color") ?? "#7c7c7c");
  const notes = String(form.get("notes") ?? "").trim() || null;
  if (!name) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("error", "name_required");
    return NextResponse.redirect(url, { status: 303 });
  }
  await db.project.create({
    data: {
      name,
      dueDate: dueRaw ? new Date(dueRaw + "T23:59:59") : null,
      color,
      notes,
    },
  });
  return NextResponse.redirect(new URL("/projects", request.url), { status: 303 });
}
