import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // Apple/iCloud sync is retired. The "Sync" button on a stale Apple AccountRow
  // posts here; redirect quietly with the retired notice.
  const settings = new URL("/settings", request.url);
  settings.searchParams.set("error", "apple_retired");
  return NextResponse.redirect(settings, { status: 303 });
}
