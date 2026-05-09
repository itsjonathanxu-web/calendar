import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Single dispatch endpoint for calendar mutations driven from the Claude-Code-
// on-Mac side. Body shape: { ops: Op[] } where Op is one of the variants below.
// Atomic-ish: ops run sequentially; we collect results + errors and return both.

type CreateEventOp = {
  op: "create_event";
  // Either an existing calendarId OR a new task category to create first.
  calendarId?: string;
  newCategoryName?: string;
  newCategoryColor?: string;
  title: string;
  start: string; // ISO
  end: string;   // ISO
  allDay?: boolean;
  rrule?: string;
  notes?: string;
  kind?: string; // defaults to "event" or "task" if section=tasks
};

type UpdateEventOp = {
  op: "update_event";
  id: string;
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  rrule?: string | null;
  notes?: string | null;
  calendarId?: string;
};

type DeleteEventOp = { op: "delete_event"; id: string };

type CreateCategoryOp = {
  op: "create_category";
  name: string;
  color?: string;
  section?: "tasks" | "scheduling";
};

type UpdateCategoryOp = {
  op: "update_category";
  id: string;
  name?: string;
  color?: string;
  enabled?: boolean;
  section?: "tasks" | "scheduling";
};

type DeleteCategoryOp = { op: "delete_category"; id: string };

type Op =
  | CreateEventOp
  | UpdateEventOp
  | DeleteEventOp
  | CreateCategoryOp
  | UpdateCategoryOp
  | DeleteCategoryOp;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const ops = (body.ops as Op[] | undefined) ?? [];
  if (!Array.isArray(ops) || ops.length === 0) {
    return NextResponse.json({ error: "no_ops" }, { status: 400 });
  }

  const results: { ok: boolean; result?: unknown; error?: string }[] = [];

  for (const op of ops) {
    try {
      switch (op.op) {
        case "create_event": {
          let calendarId = op.calendarId;
          if (!calendarId && op.newCategoryName) {
            const acct = await db.account.upsert({
              where: { source_label: { source: "notion-mcp", label: "Imported Tasks" } },
              create: {
                source: "notion-mcp",
                label: "Imported Tasks",
                credentials: "{}",
                lastSyncAt: new Date(),
              },
              update: {},
            });
            const sourceId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const cal = await db.calendar.create({
              data: {
                accountId: acct.id,
                sourceId,
                name: op.newCategoryName,
                color: op.newCategoryColor ?? "#7c7c7c",
                enabled: true,
                section: "tasks",
                config: JSON.stringify({ sortOrder: 50 }),
              },
            });
            calendarId = cal.id;
          }
          if (!calendarId) throw new Error("create_event needs calendarId or newCategoryName");
          const cal = await db.calendar.findUnique({
            where: { id: calendarId },
            select: { section: true },
          });
          const ev = await db.event.create({
            data: {
              calendarId,
              sourceId: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              title: op.title,
              start: new Date(op.start),
              end: new Date(op.end),
              allDay: Boolean(op.allDay),
              rrule: op.rrule ?? null,
              notes: op.notes ?? null,
              kind: op.kind ?? (cal?.section === "tasks" ? "task" : "event"),
            },
          });
          results.push({ ok: true, result: { id: ev.id, calendarId } });
          break;
        }

        case "update_event": {
          const data: Record<string, unknown> = {};
          if (op.title !== undefined) data.title = op.title;
          if (op.start) data.start = new Date(op.start);
          if (op.end) data.end = new Date(op.end);
          if (op.allDay !== undefined) data.allDay = op.allDay;
          if (op.rrule !== undefined) data.rrule = op.rrule;
          if (op.notes !== undefined) data.notes = op.notes;
          if (op.calendarId) data.calendarId = op.calendarId;
          const ev = await db.event.update({ where: { id: op.id }, data });
          results.push({ ok: true, result: { id: ev.id } });
          break;
        }

        case "delete_event": {
          await db.event.delete({ where: { id: op.id } });
          results.push({ ok: true });
          break;
        }

        case "create_category": {
          const acct = await db.account.upsert({
            where: { source_label: { source: "notion-mcp", label: "Imported Tasks" } },
            create: {
              source: "notion-mcp",
              label: "Imported Tasks",
              credentials: "{}",
              lastSyncAt: new Date(),
            },
            update: {},
          });
          const sourceId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const cal = await db.calendar.create({
            data: {
              accountId: acct.id,
              sourceId,
              name: op.name,
              color: op.color ?? "#7c7c7c",
              enabled: true,
              section: op.section ?? "tasks",
              config: JSON.stringify({ sortOrder: 50 }),
            },
          });
          results.push({ ok: true, result: { id: cal.id, name: cal.name } });
          break;
        }

        case "update_category": {
          const data: Record<string, unknown> = {};
          if (op.name !== undefined) data.name = op.name;
          if (op.color !== undefined) data.color = op.color;
          if (op.enabled !== undefined) data.enabled = op.enabled;
          if (op.section !== undefined) data.section = op.section;
          const cal = await db.calendar.update({ where: { id: op.id }, data });
          results.push({ ok: true, result: { id: cal.id, name: cal.name } });
          break;
        }

        case "delete_category": {
          const cal = await db.calendar.findUnique({ where: { id: op.id } });
          if (cal && (cal.sourceId === "tasks" || cal.sourceId === "completed")) {
            results.push({ ok: false, error: "built-in category cannot be deleted" });
            break;
          }
          await db.calendar.delete({ where: { id: op.id } });
          results.push({ ok: true });
          break;
        }

        default:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          results.push({ ok: false, error: `unknown op: ${(op as any).op}` });
      }
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, results });
}
