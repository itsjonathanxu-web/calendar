import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const accounts = await db.account.findMany({
    include: {
      calendars: {
        include: { _count: { select: { events: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const totalEvents = await db.event.count();
  return NextResponse.json({
    totalEvents,
    accounts: accounts.map((a) => ({
      id: a.id,
      source: a.source,
      label: a.label,
      lastSyncAt: a.lastSyncAt,
      calendars: a.calendars.map((c) => ({
        id: c.id,
        name: c.name,
        enabled: c.enabled,
        eventCount: c._count.events,
        sourceId: c.sourceId,
      })),
    })),
  });
}
