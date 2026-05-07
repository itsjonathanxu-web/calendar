import { db } from "@/lib/db";

// Create the user's pre-configured progress goals (Fitness, SHAI Research,
// Stretching). Idempotent — skips any goal whose name already exists.
const PRESETS = [
  {
    name: "Fitness",
    color: "#22c55e",
    mode: "count",
    target: 6, // 3 workouts + 2 swims + 1 run = 6 sessions/week
    matchTitles: "workout,swim,run,gym,fitness,push,pull,legs",
    sortOrder: 0,
  },
  {
    name: "SHAI Research",
    color: "#dc2626",
    mode: "hours",
    target: 4,
    matchTitles: "shai",
    sortOrder: 10,
  },
  {
    name: "Stretching",
    color: "#0ea5e9",
    mode: "daily",
    target: 7,
    matchTitles: "stretch,mobility",
    sortOrder: 20,
  },
];

async function run() {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const p of PRESETS) {
    const existing = await db.progressGoal.findFirst({ where: { name: p.name } });
    if (existing) {
      skipped.push(p.name);
      continue;
    }
    await db.progressGoal.create({
      data: {
        name: p.name,
        color: p.color,
        mode: p.mode,
        target: p.target,
        matchTitles: p.matchTitles,
        sortOrder: p.sortOrder,
      },
    });
    created.push(p.name);
  }
  return { created, skipped };
}

export async function POST() {
  const result = await run();
  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const result = await run();
  const url = new URL("/progress", request.url);
  url.searchParams.set("seeded", JSON.stringify(result));
  return Response.redirect(url, 303);
}
