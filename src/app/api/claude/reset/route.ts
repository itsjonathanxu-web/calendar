import { NextResponse } from "next/server";
import { reset } from "@/lib/scheduler/claude";

export async function POST() {
  await reset();
  return NextResponse.json({ ok: true });
}
