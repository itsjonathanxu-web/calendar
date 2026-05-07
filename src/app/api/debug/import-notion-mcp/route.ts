import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// One-time import of Notion content fetched via MCP. Re-runs idempotently — wipes the prior
// notion-mcp account first, then rebuilds buckets + events. Also threads "Running Shoes"
// into the user's Apple "Fitness" calendar so fitness items live in one place.

type Item = {
  uid: string;
  title: string;
  start: string;
  end?: string;
  notes?: string;
};

type Bucket = {
  key: string;
  name: string;
  color: string;
  sortOrder: number;
  items: Item[];
};

const ALL_DAY = (d: string, end?: string) => {
  const s = new Date(d + "T00:00:00");
  const e = end ? new Date(end + "T23:59:59") : new Date(d + "T23:59:59");
  return { start: s, end: e };
};

// Fitness items that should land in the user's Apple "Fitness" calendar instead of a
// notion-mcp bucket — keeps "fitness" unified.
const FITNESS_INTO_APPLE: Item[] = [
  {
    uid: "local-running-shoes",
    title: "Running Shoes (Hoka Arahi 8 / Runner's Academy)",
    start: "2026-05-31",
    notes: "Top pick: Hoka Arahi 8 size 9.5",
  },
];

const BUCKETS: Bucket[] = [
  {
    key: "shai-research",
    name: "🧪 Shai Research",
    color: "#dc2626",
    sortOrder: 0, // pinned to top
    items: [
      {
        uid: "schedule-w1",
        title: "Shai · W1: Study content",
        start: "2026-04-26",
        notes:
          "Apr 26 – May 2\n\n• Create project schedule\n• Go through Stiquito book\n• Go through Physical Computing book",
      },
      {
        uid: "schedule-w2",
        title: "Shai · W2: Nitinol testing",
        start: "2026-05-03",
        notes:
          "May 3 – May 9\n\n• Set up test space\n• Test Nitinol coiling w/ various thicknesses + bench supply\n   – 0.5mm — V:1.0  A:2.00 = fast displacement",
      },
      {
        uid: "schedule-w3",
        title: "Shai · W3: Nitinol testing — record",
        start: "2026-05-10",
        notes:
          "May 10 – May 16\n\n• Continued Nitinol testing\n• Record displacement (mm) at each voltage step\n• Determine voltage, mA, resistance, and length to use",
      },
      {
        uid: "schedule-w4",
        title: "Shai · W4: Testing with knit",
        start: "2026-05-17",
        notes:
          "May 17 – May 23\n\n• Test Nitinol coil embedded in knit\n• Purchase PCB / swarm parts for next week development",
      },
      {
        uid: "schedule-w5",
        title: "Shai · W5: PCB",
        start: "2026-05-24",
        notes:
          "May 24 – May 30\n\n• Set up PCB (Arduino) development environment\n• Code:\n   – Pulse Frequency Modulation\n   – Leg Movement",
      },
      {
        uid: "schedule-w6",
        title: "Shai · W6: PCB — sensors",
        start: "2026-05-31",
        notes: "May 31 – Jun 6\n\n• Integrate proximity sensor + swarm controls",
      },
      {
        uid: "schedule-w7",
        title: "Shai · W7: Swarm body",
        start: "2026-06-07",
        notes:
          "Jun 7 – Jun 13\n\n• Custom develop swarm body that fits necessary parts — 3D printed",
      },
      {
        uid: "schedule-w8",
        title: "Shai · W8: Finalize swarm body",
        start: "2026-06-14",
        notes:
          "Jun 14 – Jun 20\n\n• Finalize 1 swarm body with nitinol coil & microcontrollers attached",
      },
      {
        uid: "schedule-w9",
        title: "Shai · W9: Swarm development",
        start: "2026-06-21",
        notes: "Jun 21 – Jun 27\n\n• Test swarm with knit\n• Create 4 swarm units",
      },
      {
        uid: "schedule-w10",
        title: "Shai · W10: Finale",
        start: "2026-06-28",
        notes: "Jun 28 – Jul 4\n\n• Final test and documentation",
      },
    ],
  },
  {
    key: "toronto-cinematic",
    name: "🎬 Toronto Cinematic",
    color: "#14b8a6",
    sortOrder: 10,
    items: [
      { uid: "task-toronto-brainstorm", title: "TORONTO: Brainstorm", start: "2026-05-10" },
      { uid: "task-toronto-storyboard", title: "TORONTO: Storyboarding + Music", start: "2026-05-17" },
    ],
  },
  {
    key: "chinese-learning",
    name: "🇨🇳 Chinese Learning",
    color: "#eab308",
    sortOrder: 20,
    items: [
      // intentionally empty — kept as a bucket per user request
    ],
  },
  {
    key: "notion-tasks",
    name: "📋 Notion Tasks",
    color: "#7c7c7c",
    sortOrder: 90, // catch-all goes last
    items: [
      // From TASKS DB (Done = false), pulled via Notion search 2026-05-07.
      // Verified live against the Tasks data source at collection://2de59533-7c79-812f-a312-000b35ecaac9.
      { uid: "task-find-podcasts", title: "Find Podcasts", start: "2026-05-09", notes: "Sequioa Summit\nhttps://www.acquired.fm/" },
      { uid: "task-linkedin-x", title: "Look into LinkedIn and X creators", start: "2026-05-08" },
      { uid: "task-cinematic-lighting", title: "Learn Cinematic Lighting", start: "2026-05-09", notes: "Udemy: Cinematic Lighting · Reilin Joey Secret Sauce · Filmmakers Academy" },
      { uid: "task-tell-team-lead", title: "Tell Team Lead — Leaving for NUS MDes + Surgery", start: "2026-05-11", notes: "Flying out July 24, 2026. Surgery end of May." },
      { uid: "task-plan-sea", title: "Plan Travel Around SEA", start: "2026-05-16" },
      { uid: "task-buy-cred", title: "BUY CRED", start: "2026-05-17" },
      { uid: "task-claude-course", title: "Claude Course", start: "2026-05-30", notes: "Claude 101 · Claude Course · AI Fluency" },
      { uid: "task-yc-app", title: "Draft Y Combinator Application", start: "2026-11-30" },
      { uid: "task-sg-creators", title: "Reach out to Singapore travel/video creators on LinkedIn", start: "2026-06-30", notes: "5 coffee chats Aug–Dec" },
    ],
  },
];

// Allow either POST (programmatic) or GET (clicked in a browser).
export async function GET(request: Request) {
  const result = await runImport();
  // After the import, send the user back to Settings so they can see the new buckets.
  const url = new URL("/settings", request.url);
  url.searchParams.set("synced", "categories");
  url.searchParams.set("count", `${result.buckets} buckets · ${result.events} events`);
  return Response.redirect(url, 303);
}

export async function POST() {
  const result = await runImport();
  return Response.json({ ok: true, ...result });
}

async function runImport() {
  // 1. Wipe any prior MCP import so re-running is idempotent
  const existing = await db.account.findFirst({ where: { source: "notion-mcp" } });
  if (existing) {
    await db.account.delete({ where: { id: existing.id } });
  }

  // 2. Create the notion-mcp account + buckets
  const account = await db.account.create({
    data: {
      source: "notion-mcp",
      label: "Life · Tasks + Action Plans",
      credentials: "{}",
      lastSyncAt: new Date(),
    },
  });

  let totalEvents = 0;
  for (const bucket of BUCKETS) {
    const cal = await db.calendar.create({
      data: {
        accountId: account.id,
        sourceId: bucket.key,
        name: bucket.name,
        color: bucket.color,
        enabled: true,
        // store sortOrder in config so FilterSidebar can sort by it
        config: JSON.stringify({ sortOrder: bucket.sortOrder }),
      },
    });
    for (const it of bucket.items) {
      const dates = ALL_DAY(it.start, it.end);
      await db.event.create({
        data: {
          calendarId: cal.id,
          sourceId: it.uid,
          title: it.title,
          start: dates.start,
          end: dates.end,
          allDay: true,
          notes: it.notes ?? null,
          kind: "task",
        },
      });
      totalEvents += 1;
    }
  }

  // 3. Inject fitness items into Apple "Fitness" calendar (replace any prior local-fitness items first)
  const appleFitness = await db.calendar.findFirst({
    where: {
      account: { source: "apple" },
      name: "Fitness",
    },
  });
  if (appleFitness) {
    // Clear prior locally-added fitness items so re-runs don't duplicate
    await db.event.deleteMany({
      where: {
        calendarId: appleFitness.id,
        kind: "task",
      },
    });
    for (const it of FITNESS_INTO_APPLE) {
      const dates = ALL_DAY(it.start, it.end);
      await db.event.create({
        data: {
          calendarId: appleFitness.id,
          sourceId: it.uid,
          title: it.title,
          start: dates.start,
          end: dates.end,
          allDay: true,
          notes: it.notes ?? null,
          kind: "task", // local — won't be deleted by Apple sync
        },
      });
      totalEvents += 1;
    }
  }

  return {
    accountId: account.id,
    buckets: BUCKETS.length,
    events: totalEvents,
    appleFitnessFound: Boolean(appleFitness),
  };
}
