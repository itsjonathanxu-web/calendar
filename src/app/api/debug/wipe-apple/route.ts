import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pull } from "@/lib/sources/apple";

// Force-clear every Apple-sourced Event row (kind="event"; locally-added kind="task" is preserved)
// and re-sync from iCloud. Use this when stale duplicate rows are left over from an older
// sync run that didn't relate recurring exceptions properly.
async function run() {
  const accounts = await db.account.findMany({ where: { source: "apple" } });
  let deleted = 0;
  let pulled = 0;
  for (const account of accounts) {
    const cals = await db.calendar.findMany({ where: { accountId: account.id } });
    for (const cal of cals) {
      const res = await db.event.deleteMany({
        where: { calendarId: cal.id, kind: "event" },
      });
      deleted += res.count;
    }
    const result = await pull(account.id);
    pulled += result.events;
  }
  return { accounts: accounts.length, deleted, pulled };
}

export async function POST() {
  const result = await run();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const result = await run();
  const url = new URL("/calendar", request.url);
  url.searchParams.set("wiped", `${result.deleted} → ${result.pulled}`);
  return Response.redirect(url, 303);
}
