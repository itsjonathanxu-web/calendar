import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, saveAccountFromTokens, pull } from "@/lib/sources/google";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const c = await cookies();
  const expectedState = c.get("g_state")?.value;
  c.delete("g_state");

  const settings = new URL("/settings", request.url);

  if (error) {
    settings.searchParams.set("error", `google_${error}`);
    return NextResponse.redirect(settings, { status: 303 });
  }
  if (!code || !state || state !== expectedState) {
    settings.searchParams.set("error", "google_state_mismatch");
    return NextResponse.redirect(settings, { status: 303 });
  }

  try {
    const tokens = await exchangeCode(code);
    const accountId = await saveAccountFromTokens(tokens);
    await pull(accountId);
    settings.searchParams.set("connected", "google");
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    settings.searchParams.set("error", "google_exchange_failed");
  }

  return NextResponse.redirect(settings, { status: 303 });
}
