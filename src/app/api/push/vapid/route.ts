import { NextResponse } from "next/server";
import { getPublicVapidKey } from "@/lib/push";

export async function GET() {
  try {
    return NextResponse.json({ publicKey: getPublicVapidKey() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "vapid_missing" },
      { status: 500 },
    );
  }
}
