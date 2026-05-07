import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { consentUrl, isGoogleConfigured } from "@/lib/sources/google";

export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(
      new URL("/settings?error=google_not_configured", "http://localhost:3000"),
      { status: 303 },
    );
  }
  const state = randomBytes(24).toString("hex");
  const c = await cookies();
  c.set("g_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });
  return NextResponse.redirect(consentUrl(state));
}
