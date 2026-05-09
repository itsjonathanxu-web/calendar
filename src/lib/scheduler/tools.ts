import { db } from "@/lib/db";
import { isInstanceId, parseInstanceId } from "@/lib/calendar/recurrence";

// All tool input/output shapes + server-side executors live here. The chat
// loop hands tool_use blocks straight to runTool() which mutates the DB and
// returns:
//   - tool_result content (small JSON the model sees back)
//   - an Applied entry the client renders + uses for undo
//
// Server executes everything; the client is a renderer. Each Applied entry
// carries before-state snapshots so the undo path can reconstruct.

export type AppliedEntry =
  | {
      kind: "event_created";
      eventId: string;
      title: string;
      start: string | null;
      end: string | null;
      allDay: boolean;
      rrule: string | null;
      calendarId: string;
      calendarName: string;
      calendarColor: string;
      createdCategoryId: string | null;
    }
  | {
      kind: "event_updated";
      eventId: string;
      title: string;
      calendarName: string;
      calendarColor: string;
      before: EventSnapshot;
      after: EventSnapshot;
    }
  | {
      kind: "event_deleted";
      title: string;
      calendarName: string;
      calendarColor: string;
      restore: EventSnapshot;
    }
  | {
      kind: "event_split";
      title: string;
      calendarName: string;
      calendarColor: string;
      newEventIds: string[];
      restore: EventSnapshot;
    }
  | {
      kind: "event_cloned";
      title: string;
      eventId: string;
      calendarName: string;
      calendarColor: string;
      start: string | null;
      end: string | null;
    }
  | {
      kind: "category_created";
      categoryId: string;
      name: string;
      color: string;
      section: string;
    }
  | {
      kind: "category_updated";
      categoryId: string;
      name: string;
      color: string;
      section: string;
      before: { name: string; color: string; section: string };
    }
  | {
      kind: "category_deleted";
      name: string;
      color: string;
      removedEventIds: string[];
    }
  | {
      kind: "archived_completed";
      count: number;
    }
  | {
      kind: "rule_saved";
      ruleId: string;
      text: string;
      priority: number;
    }
  | {
      kind: "working_hours_updated";
      newStart: string;
      newEnd: string;
      before: { start: string; end: string };
    };

export type EventSnapshot = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  notes: string | null;
  rrule: string | null;
  calendarId: string;
};

// ── Tool definitions for Anthropic API ──────────────────────────────────────
// Anthropic.Tool array. Schemas are intentionally permissive — we validate
// at execution time and return clear errors back to the model so it can retry.

import type Anthropic from "@anthropic-ai/sdk";

export const TOOLS: Anthropic.Tool[] = [
  // ── ACTIONS (mutate) ────────────────────────────────────────────────────
  {
    name: "propose_event",
    description:
      "Create a new event. Pass calendarId for an existing category, or " +
      "newCategoryName + newCategoryColor to auto-create one. Use rrule for " +
      "recurring (e.g. FREQ=WEEKLY;BYDAY=SA;UNTIL=20260531T235959Z).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "ISO-8601 start" },
        end: { type: "string", description: "ISO-8601 end" },
        calendarId: { type: "string" },
        newCategoryName: { type: "string" },
        newCategoryColor: { type: "string" },
        newCategorySection: { type: "string", enum: ["scheduling", "tasks"] },
        allDay: { type: "boolean" },
        rrule: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "propose_update_event",
    description:
      "Update any field of an existing event. Pass eventId plus only the " +
      "fields you want to change. Use this for: rename (newTitle), move time " +
      "(newStart+newEnd), change category (newCalendarId or newCategoryName), " +
      "edit notes, change recurrence. Replaces the older propose_reschedule " +
      "and propose_change_category — prefer this single tool.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        newTitle: { type: "string" },
        newStart: { type: "string" },
        newEnd: { type: "string" },
        newAllDay: { type: "boolean" },
        newNotes: { type: ["string", "null"] },
        newRrule: { type: ["string", "null"] },
        newCalendarId: { type: "string" },
        newCategoryName: { type: "string" },
        newCategoryColor: { type: "string" },
        scope: {
          type: "string",
          enum: ["all", "this", "future"],
          description: "For recurring events; defaults to 'all' for masters",
        },
      },
      required: ["eventId"],
    },
  },
  {
    name: "propose_delete",
    description:
      "Delete an event. For 'every Saturday X' / 'all my Y', pass the master " +
      "id from the recurring-series block — the cascade removes the whole series.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        title: { type: "string", description: "Current title for confirmation" },
      },
      required: ["eventId", "title"],
    },
  },
  {
    name: "propose_split_event",
    description:
      "Break a single event into N sequential pieces with optional gaps. " +
      "Useful for 'split my 4hr block into 2x 2hr with a 30min break'. " +
      "Pass parts: array of {durationMinutes, gapBeforeMinutes?}.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        parts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              durationMinutes: { type: "integer" },
              gapBeforeMinutes: { type: "integer" },
            },
            required: ["durationMinutes"],
          },
        },
      },
      required: ["eventId", "parts"],
    },
  },
  {
    name: "propose_clone_event",
    description:
      "Duplicate an event at a new start time. Same title, calendar, " +
      "duration, allDay, notes; rrule is intentionally NOT copied. Use for " +
      "'do this again next Tuesday' / 'copy yesterday's gym session to today'.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        newStart: { type: "string" },
      },
      required: ["eventId", "newStart"],
    },
  },
  {
    name: "propose_create_category",
    description:
      "Create a calendar category with no event attached. Use for 'make a " +
      "new category called Travel Planning' or before bulk-creating a series " +
      "of events that should share one new home.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        color: { type: "string" },
        section: { type: "string", enum: ["scheduling", "tasks"] },
      },
      required: ["name"],
    },
  },
  {
    name: "propose_update_category",
    description:
      "Rename, recolor, or move a category between sections. " +
      "Only local (notion-mcp) categories can be safely renamed.",
    input_schema: {
      type: "object",
      properties: {
        categoryId: { type: "string" },
        newName: { type: "string" },
        newColor: { type: "string" },
        newSection: { type: "string", enum: ["scheduling", "tasks"] },
      },
      required: ["categoryId"],
    },
  },
  {
    name: "propose_delete_category",
    description:
      "Remove a category and ALL its events. Destructive. Use only when the " +
      "user explicitly asks to wipe a category. Won't touch built-in 📋 Tasks " +
      "or ✓ Completed.",
    input_schema: {
      type: "object",
      properties: {
        categoryId: { type: "string" },
      },
      required: ["categoryId"],
    },
  },
  {
    name: "propose_archive_completed",
    description:
      "Move every checked-off task into the ✓ Completed bucket. Cleanup tool — " +
      "use when the user asks to 'archive done', 'clear completed', etc.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_rule",
    description:
      "Persist a new scheduling rule the user stated as a preference (e.g. " +
      "'no meetings before 10am'). Higher priority applies first.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        priority: { type: "integer" },
      },
      required: ["text"],
    },
  },
  {
    name: "update_working_hours",
    description: "Update the default working-hours window (HH:MM 24h).",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string" },
        end: { type: "string" },
      },
      required: ["start", "end"],
    },
  },

  // ── READ-ONLY (no mutation, returns data the model uses to plan) ─────────
  {
    name: "describe_availability",
    description:
      "Return free time slots over the next N days. The model should call " +
      "this BEFORE proposing slots in 'find me time for X' or 'what should I " +
      "do today since work was cancelled' scenarios. Returns: per-day list " +
      "of free windows (start, end, durationMinutes) with notes about whether " +
      "each window is inside or outside working hours.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of days forward (1-30)" },
      },
    },
  },
  {
    name: "find_events",
    description:
      "Search events by title substring (case-insensitive). Returns matching " +
      "events with id, title, start/end, calendar, and rrule. Use this when " +
      "the user references events by name and you need their ids — especially " +
      "for 'all X' bulk ops to ensure you find every match.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to match in title" },
        days: { type: "integer", description: "Days forward to search (default 90)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_categories",
    description:
      "List every available calendar/category with id, name, color, and " +
      "section. Helpful before bulk recategorize when the model needs to " +
      "confirm a target id by name.",
    input_schema: { type: "object", properties: {} },
  },
];

// ── Executor ────────────────────────────────────────────────────────────────

export type RunResult = {
  toolResult: unknown;
  applied?: AppliedEntry;
  error?: string;
};

const COMPLETED_CALENDAR_NAME = "✓ Completed";

async function calMeta(calendarId: string) {
  const c = await db.calendar.findUnique({
    where: { id: calendarId },
    select: { id: true, name: true, color: true, section: true },
  });
  return c ?? { id: calendarId, name: "?", color: "#7c7c7c", section: "scheduling" };
}

async function snapshotEvent(eventId: string): Promise<EventSnapshot | null> {
  const realId = isInstanceId(eventId) ? parseInstanceId(eventId)?.masterId ?? eventId : eventId;
  const ev = await db.event.findUnique({ where: { id: realId } });
  if (!ev) return null;
  return {
    title: ev.title,
    start: ev.start.toISOString(),
    end: ev.end.toISOString(),
    allDay: ev.allDay,
    notes: ev.notes,
    rrule: ev.rrule,
    calendarId: ev.calendarId,
  };
}

async function ensureCategory(input: {
  newCategoryName?: string;
  newCategoryColor?: string;
  newCategorySection?: string;
  calendarId?: string;
}): Promise<{ id: string; createdId: string | null }> {
  if (input.calendarId) return { id: input.calendarId, createdId: null };
  if (!input.newCategoryName) throw new Error("calendarId or newCategoryName required");
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
  const sourceId = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const cal = await db.calendar.create({
    data: {
      accountId: acct.id,
      sourceId,
      name: input.newCategoryName,
      color: input.newCategoryColor ?? "#7c7c7c",
      enabled: true,
      section: input.newCategorySection === "tasks" ? "tasks" : "scheduling",
      config: JSON.stringify({ sortOrder: 50 }),
    },
  });
  return { id: cal.id, createdId: cal.id };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runTool(name: string, input: any): Promise<RunResult> {
  try {
    switch (name) {
      case "propose_event": {
        const { id: calendarId, createdId } = await ensureCategory({
          calendarId: input.calendarId,
          newCategoryName: input.newCategoryName,
          newCategoryColor: input.newCategoryColor,
          newCategorySection: input.newCategorySection,
        });
        const cal = await calMeta(calendarId);
        const ev = await db.event.create({
          data: {
            calendarId,
            sourceId: `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            title: input.title,
            start: new Date(input.start),
            end: new Date(input.end),
            allDay: Boolean(input.allDay),
            notes: input.notes ?? null,
            rrule: input.rrule ?? null,
            kind: cal.section === "tasks" ? "task" : "event",
          },
        });
        return {
          toolResult: { ok: true, eventId: ev.id, calendarName: cal.name },
          applied: {
            kind: "event_created",
            eventId: ev.id,
            title: ev.title,
            start: ev.start.toISOString(),
            end: ev.end.toISOString(),
            allDay: ev.allDay,
            rrule: ev.rrule,
            calendarId,
            calendarName: cal.name,
            calendarColor: cal.color,
            createdCategoryId: createdId,
          },
        };
      }

      case "propose_update_event": {
        const id = String(input.eventId);
        const before = await snapshotEvent(id);
        if (!before) {
          return { toolResult: { ok: false, error: "event_not_found" }, error: "event_not_found" };
        }
        const data: Record<string, unknown> = {};
        if (typeof input.newTitle === "string") data.title = input.newTitle;
        if (typeof input.newStart === "string") data.start = new Date(input.newStart);
        if (typeof input.newEnd === "string") data.end = new Date(input.newEnd);
        if (typeof input.newAllDay === "boolean") data.allDay = input.newAllDay;
        if (input.newNotes !== undefined) data.notes = input.newNotes;
        if (input.newRrule !== undefined) data.rrule = input.newRrule;

        let targetCalendarId = before.calendarId;
        if (input.newCalendarId || input.newCategoryName) {
          const { id: calId } = await ensureCategory({
            calendarId: input.newCalendarId,
            newCategoryName: input.newCategoryName,
            newCategoryColor: input.newCategoryColor,
          });
          targetCalendarId = calId;
          data.calendarId = calId;
        }

        // Resolve recurring-instance ids back to the master.
        const realId = isInstanceId(id) ? parseInstanceId(id)?.masterId ?? id : id;
        const updated = await db.event.update({ where: { id: realId }, data });
        const cal = await calMeta(targetCalendarId);
        const after: EventSnapshot = {
          title: updated.title,
          start: updated.start.toISOString(),
          end: updated.end.toISOString(),
          allDay: updated.allDay,
          notes: updated.notes,
          rrule: updated.rrule,
          calendarId: updated.calendarId,
        };
        return {
          toolResult: { ok: true, eventId: updated.id },
          applied: {
            kind: "event_updated",
            eventId: updated.id,
            title: updated.title,
            calendarName: cal.name,
            calendarColor: cal.color,
            before,
            after,
          },
        };
      }

      case "propose_delete": {
        const id = String(input.eventId);
        const before = await snapshotEvent(id);
        if (!before) {
          return { toolResult: { ok: false, error: "event_not_found" }, error: "event_not_found" };
        }
        const realId = isInstanceId(id) ? parseInstanceId(id)?.masterId ?? id : id;
        await db.event.delete({ where: { id: realId } });
        const cal = await calMeta(before.calendarId);
        return {
          toolResult: { ok: true },
          applied: {
            kind: "event_deleted",
            title: before.title,
            calendarName: cal.name,
            calendarColor: cal.color,
            restore: before,
          },
        };
      }

      case "propose_split_event": {
        const id = String(input.eventId);
        const realId = isInstanceId(id) ? parseInstanceId(id)?.masterId ?? id : id;
        const before = await snapshotEvent(realId);
        if (!before) {
          return { toolResult: { ok: false, error: "event_not_found" }, error: "event_not_found" };
        }
        const parts = (input.parts ?? []) as { durationMinutes: number; gapBeforeMinutes?: number }[];
        if (parts.length < 2) {
          return { toolResult: { ok: false, error: "need_at_least_2_parts" } };
        }
        // Delete the original and create N pieces sequentially.
        await db.event.delete({ where: { id: realId } });
        let cursor = new Date(before.start).getTime();
        const newIds: string[] = [];
        for (const p of parts) {
          cursor += (p.gapBeforeMinutes ?? 0) * 60_000;
          const start = new Date(cursor);
          const end = new Date(cursor + p.durationMinutes * 60_000);
          const ev = await db.event.create({
            data: {
              calendarId: before.calendarId,
              sourceId: `split-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              title: before.title,
              start,
              end,
              allDay: before.allDay,
              notes: before.notes,
              kind: "event",
            },
          });
          newIds.push(ev.id);
          cursor = end.getTime();
        }
        const cal = await calMeta(before.calendarId);
        return {
          toolResult: { ok: true, newEventIds: newIds },
          applied: {
            kind: "event_split",
            title: before.title,
            calendarName: cal.name,
            calendarColor: cal.color,
            newEventIds: newIds,
            restore: before,
          },
        };
      }

      case "propose_clone_event": {
        const id = String(input.eventId);
        const before = await snapshotEvent(id);
        if (!before) {
          return { toolResult: { ok: false, error: "event_not_found" }, error: "event_not_found" };
        }
        const dur = new Date(before.end).getTime() - new Date(before.start).getTime();
        const newStart = new Date(input.newStart);
        const newEnd = new Date(newStart.getTime() + dur);
        const clone = await db.event.create({
          data: {
            calendarId: before.calendarId,
            sourceId: `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            title: before.title,
            start: newStart,
            end: newEnd,
            allDay: before.allDay,
            notes: before.notes,
            kind: "event",
          },
        });
        const cal = await calMeta(before.calendarId);
        return {
          toolResult: { ok: true, eventId: clone.id },
          applied: {
            kind: "event_cloned",
            title: clone.title,
            eventId: clone.id,
            calendarName: cal.name,
            calendarColor: cal.color,
            start: clone.start.toISOString(),
            end: clone.end.toISOString(),
          },
        };
      }

      case "propose_create_category": {
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
        const sourceId = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const cal = await db.calendar.create({
          data: {
            accountId: acct.id,
            sourceId,
            name: String(input.name),
            color: typeof input.color === "string" ? input.color : "#7c7c7c",
            enabled: true,
            section: input.section === "tasks" ? "tasks" : "scheduling",
            config: JSON.stringify({ sortOrder: 50 }),
          },
        });
        return {
          toolResult: { ok: true, categoryId: cal.id },
          applied: {
            kind: "category_created",
            categoryId: cal.id,
            name: cal.name,
            color: cal.color,
            section: cal.section ?? "scheduling",
          },
        };
      }

      case "propose_update_category": {
        const id = String(input.categoryId);
        const before = await db.calendar.findUnique({
          where: { id },
          select: { name: true, color: true, section: true },
        });
        if (!before) {
          return { toolResult: { ok: false, error: "category_not_found" } };
        }
        const data: Record<string, unknown> = {};
        if (typeof input.newName === "string") data.name = input.newName;
        if (typeof input.newColor === "string") data.color = input.newColor;
        if (input.newSection === "tasks" || input.newSection === "scheduling") {
          data.section = input.newSection;
        }
        const updated = await db.calendar.update({ where: { id }, data });
        return {
          toolResult: { ok: true },
          applied: {
            kind: "category_updated",
            categoryId: id,
            name: updated.name,
            color: updated.color,
            section: updated.section ?? "scheduling",
            before: {
              name: before.name,
              color: before.color,
              section: before.section ?? "scheduling",
            },
          },
        };
      }

      case "propose_delete_category": {
        const id = String(input.categoryId);
        const cal = await db.calendar.findUnique({
          where: { id },
          select: { id: true, name: true, color: true, sourceId: true },
        });
        if (!cal) return { toolResult: { ok: false, error: "category_not_found" } };
        if (cal.sourceId === "tasks" || cal.sourceId === "completed") {
          return { toolResult: { ok: false, error: "builtin_protected" } };
        }
        const events = await db.event.findMany({
          where: { calendarId: id },
          select: { id: true },
        });
        await db.calendar.delete({ where: { id } });
        return {
          toolResult: { ok: true, removedEvents: events.length },
          applied: {
            kind: "category_deleted",
            name: cal.name,
            color: cal.color,
            removedEventIds: events.map((e) => e.id),
          },
        };
      }

      case "propose_archive_completed": {
        const completed = await db.calendar.findFirst({
          where: { name: COMPLETED_CALENDAR_NAME },
          select: { id: true },
        });
        if (!completed) {
          return { toolResult: { ok: false, error: "no_completed_calendar" } };
        }
        // The toggle-complete flow already moves checked tasks. This tool is
        // a backstop: any task event with completedFromCalendarId set is by
        // definition completed already, so just confirm.
        const tally = await db.event.count({
          where: { calendarId: completed.id },
        });
        return {
          toolResult: { ok: true, count: tally, hint: "Use the checkbox in the UI to mark tasks complete; they auto-move to ✓ Completed." },
          applied: {
            kind: "archived_completed",
            count: tally,
          },
        };
      }

      case "save_rule": {
        const r = await db.rule.create({
          data: {
            text: String(input.text),
            priority: Number(input.priority ?? 50),
          },
        });
        return {
          toolResult: { ok: true, ruleId: r.id },
          applied: {
            kind: "rule_saved",
            ruleId: r.id,
            text: r.text,
            priority: r.priority,
          },
        };
      }

      case "update_working_hours": {
        const before = await db.settings.findUnique({ where: { id: "settings" } });
        const next = { start: String(input.start), end: String(input.end) };
        await db.settings.upsert({
          where: { id: "settings" },
          create: { id: "settings", workdayStart: next.start, workdayEnd: next.end },
          update: { workdayStart: next.start, workdayEnd: next.end },
        });
        return {
          toolResult: { ok: true },
          applied: {
            kind: "working_hours_updated",
            newStart: next.start,
            newEnd: next.end,
            before: {
              start: before?.workdayStart ?? "09:00",
              end: before?.workdayEnd ?? "18:00",
            },
          },
        };
      }

      case "describe_availability": {
        const days = Math.min(30, Math.max(1, Number(input.days ?? 14)));
        return {
          toolResult: await computeAvailability(days),
        };
      }

      case "find_events": {
        const q = String(input.query ?? "").trim().toLowerCase();
        if (!q) return { toolResult: { ok: false, error: "empty_query" } };
        const days = Math.min(365, Math.max(1, Number(input.days ?? 90)));
        const since = new Date(Date.now() - 7 * 86400_000);
        const until = new Date(Date.now() + days * 86400_000);
        const rows = await db.event.findMany({
          where: {
            AND: [{ start: { lt: until } }, { end: { gt: since } }],
            calendar: { enabled: true },
          },
          include: { calendar: { select: { id: true, name: true } } },
          orderBy: { start: "asc" },
          take: 200,
        });
        const matches = rows
          .filter((r) => r.title.toLowerCase().includes(q))
          .map((r) => ({
            id: r.id,
            title: r.title,
            start: r.start.toISOString(),
            end: r.end.toISOString(),
            rrule: r.rrule,
            calendarId: r.calendarId,
            calendarName: r.calendar.name,
          }));
        return { toolResult: { ok: true, matches, count: matches.length } };
      }

      case "list_categories": {
        const rows = await db.calendar.findMany({
          select: { id: true, name: true, color: true, section: true, enabled: true },
          orderBy: [{ section: "asc" }, { name: "asc" }],
        });
        return { toolResult: { ok: true, categories: rows } };
      }
    }
    return { toolResult: { ok: false, error: `unknown_tool:${name}` }, error: "unknown_tool" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { toolResult: { ok: false, error: msg }, error: msg };
  }
}

// ── Availability calculator ────────────────────────────────────────────────
// Fast and approximate: walks each day, subtracts existing events from the
// 6am–11pm window, returns the remaining gaps. Distinguishes inside-work
// vs outside-work-hours so the model can pick the right kind for the request.

async function computeAvailability(days: number) {
  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  const tz = settings?.timezone ?? "America/Toronto";
  const workStart = settings?.workdayStart ?? "09:00";
  const workEnd = settings?.workdayEnd ?? "18:00";

  const now = new Date();
  const since = new Date(now);
  const until = new Date(now.getTime() + days * 86400_000);

  // Pull non-recurring + recurring masters within the window.
  const [nonRecurring, masters] = await Promise.all([
    db.event.findMany({
      where: {
        AND: [{ start: { lt: until } }, { end: { gt: since } }],
        rrule: null,
        recurrenceParentId: null,
        calendar: { enabled: true },
      },
      select: { id: true, start: true, end: true, allDay: true, title: true, calendar: { select: { name: true } } },
    }),
    db.event.findMany({
      where: { rrule: { not: null }, recurrenceParentId: null, calendar: { enabled: true } },
      select: { id: true, start: true, end: true, rrule: true, allDay: true, title: true, calendar: { select: { name: true } } },
    }),
  ]);

  const { expandRRule } = await import("@/lib/calendar/recurrence");
  const busy: { start: Date; end: Date; title: string }[] = nonRecurring.map((e) => ({
    start: e.start,
    end: e.end,
    title: e.title,
  }));
  for (const m of masters) {
    if (!m.rrule) continue;
    const dur = m.end.getTime() - m.start.getTime();
    const occ = expandRRule(m.start, m.rrule, since, until);
    for (const o of occ) busy.push({ start: o, end: new Date(o.getTime() + dur), title: m.title });
  }
  busy.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Per-day window 6am→11pm in user's TZ. We approximate by using server-local
  // boundaries since the user's tz settings aren't authoritative on Fly UTC,
  // but we report local times in the output strings.
  const outDays: Array<{
    date: string;
    weekday: string;
    workdayStart: string;
    workdayEnd: string;
    freeSlots: { start: string; end: string; durationMinutes: number; insideWorkHours: boolean }[];
  }> = [];

  for (let d = 0; d < days; d++) {
    const dayStart = new Date(now.getTime() + d * 86400_000);
    dayStart.setHours(6, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 0, 0, 0);

    const [whStartH, whStartM] = workStart.split(":").map(Number);
    const [whEndH, whEndM] = workEnd.split(":").map(Number);
    const whStart = new Date(dayStart);
    whStart.setHours(whStartH ?? 9, whStartM ?? 0, 0, 0);
    const whEnd = new Date(dayStart);
    whEnd.setHours(whEndH ?? 18, whEndM ?? 0, 0, 0);

    // Subtract busy intervals from [dayStart, dayEnd]
    const dayBusy = busy
      .filter((b) => b.end > dayStart && b.start < dayEnd)
      .map((b) => ({
        start: b.start < dayStart ? dayStart : b.start,
        end: b.end > dayEnd ? dayEnd : b.end,
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const merged: { start: Date; end: Date }[] = [];
    for (const b of dayBusy) {
      const last = merged[merged.length - 1];
      if (last && b.start <= last.end) {
        last.end = b.end > last.end ? b.end : last.end;
      } else {
        merged.push({ ...b });
      }
    }
    const free: { start: Date; end: Date }[] = [];
    let cursor = dayStart;
    for (const b of merged) {
      if (b.start > cursor) free.push({ start: cursor, end: b.start });
      cursor = b.end > cursor ? b.end : cursor;
    }
    if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });

    const slots = free
      .filter((f) => f.end.getTime() - f.start.getTime() >= 15 * 60_000)
      .map((f) => ({
        start: f.start.toISOString(),
        end: f.end.toISOString(),
        durationMinutes: Math.round((f.end.getTime() - f.start.getTime()) / 60_000),
        insideWorkHours: f.start >= whStart && f.end <= whEnd,
      }));

    outDays.push({
      date: dayStart.toLocaleDateString("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      weekday: dayStart.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" }),
      workdayStart: workStart,
      workdayEnd: workEnd,
      freeSlots: slots,
    });
  }

  return { ok: true, days: outDays };
}
