import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // Apple/iCloud sync is retired. Surface a clear error if anything still
  // posts here (e.g. a cached form on a stale page).
  const settings = new URL("/settings", request.url);
  settings.searchParams.set("error", "apple_retired");
  return NextResponse.redirect(settings, { status: 303 });
}
