import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { addDays } from "date-fns";
import { db } from "@/lib/db";

const SONNET_MODEL = "claude-sonnet-4-6";
const HAIKU_MODEL = "claude-haiku-4-5";

// Route simple slot/add requests to Haiku (~15× cheaper) and reserve Sonnet
// for messages that imply multi-event constraint solving (move, reschedule,
// shift, push around). Anchor on intent keywords; if anything cascade-y is
// mentioned, take the Sonnet path even if the rest of the message is short.
function pickModel(userMessage: string): string {
  const msg = userMessage.toLowerCase();
  const cascadeRx =
    /\b(move|reschedule|rearrang|shift|swap|push (back|out|up|over)|fit (it|this|that)?[^.]*\band\b|other (events?|things?|stuff)|delete|remove|cancel|take out|get rid|clear|change all|every|recategoriz|change.{0,30}category|move.{0,30}category)\b/;
  if (cascadeRx.test(msg)) return SONNET_MODEL;
  return HAIKU_MODEL;
}

export type ToolUse =
  | {
      type: "propose_event";
      title: string;
      start: string;
      end: string;
      // Either an existing calendar id OR a new task category to create on confirm.
      calendarId?: string;
      newCategoryName?: string;
      newCategoryColor?: string;
      allDay?: boolean;
      notes?: string;
      rrule?: string;
      reasoning?: string;
    }
  | {
      type: "propose_reschedule";
      eventId: string;
      newStart: string;
      newEnd: string;
      reasoning?: string;
    }
  | {
      type: "propose_delete";
      eventId: string;
      title: string;
      reasoning?: string;
    }
  | {
      type: "propose_change_category";
      eventId: string;
      title: string;
      newCalendarId?: string;
      newCategoryName?: string;
      newCategoryColor?: string;
      reasoning?: string;
    };

export type AssistantTurn = {
  text: string;
  proposals: ToolUse[];
};

type RawTurn = {
  text: string;
  proposals: ToolUse[];
  ruleSaves: { text: string; priority: number }[];
  hourUpdates: { start: string; end: string }[];
};

// "cli" = shell out to `claude` CLI (uses Pro/Max subscription quota — free)
// "api" = SDK with ANTHROPIC_API_KEY (pay per token)
type Backend = "cli" | "api";

function pickBackend(): Backend {
  const explicit = (process.env.CLAUDE_BACKEND ?? "").toLowerCase();
  if (explicit === "cli" || explicit === "api") return explicit;
  return process.env.ANTHROPIC_API_KEY ? "api" : "cli";
}

// ── Shared context build ────────────────────────────────────────────────────

// Google accounts that should NEVER receive AI-proposed events. Hard-block by
// account label so the model can't talk itself into using them as a default.
const GOOGLE_DENYLIST = new Set(["itsjonathanxu@gmail.com"]);

async function buildContext() {
  const now = new Date();
  // Window the chat sees. 60 days forward + 7 back (so "recent" requests like
  // "the workout from yesterday" still resolve). Recurring masters bypass this
  // filter — we always include them no matter how old.
  const windowStart = addDays(now, -7);
  const windowEnd = addDays(now, 60);
  const [rules, settings, calendars, nonRecurring, masters] = await Promise.all([
    db.rule.findMany({ where: { active: true }, orderBy: { priority: "desc" } }),
    db.settings.findUnique({ where: { id: "settings" } }),
    db.calendar.findMany({
      include: { account: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    db.event.findMany({
      where: {
        AND: [{ start: { lt: windowEnd } }, { end: { gt: windowStart } }],
        rrule: null,
        recurrenceParentId: null,
        calendar: { enabled: true },
      },
      include: { calendar: { include: { account: true } } },
      orderBy: { start: "asc" },
    }),
    db.event.findMany({
      where: {
        rrule: { not: null },
        recurrenceParentId: null,
        calendar: { enabled: true },
      },
      include: { calendar: { include: { account: true } } },
      orderBy: { start: "asc" },
    }),
  ]);
  return { rules, settings, calendars, nonRecurring, masters, windowStart, windowEnd };
}

function rulesBlock(rules: { text: string; priority: number }[]): string {
  if (rules.length === 0) return "(no rules yet — call save_rule when the user states a preference)";
  return rules.map((r) => `- [${r.priority}] ${r.text}`).join("\n");
}

type EventCtx = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  rrule: string | null;
  calendar: { id: string; name: string };
};

function eventsBlock(events: EventCtx[], tz: string): string {
  if (events.length === 0) return "(no non-recurring events in window)";
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return events
    .map(
      (e) =>
        `- id=${e.id}  ${fmt(e.start)} → ${fmt(e.end)}  [${e.start.toISOString()}]  cal=${e.calendar.id} (${e.calendar.name}): ${e.title}`,
    )
    .join("\n");
}

// Recurring masters get their own block — RRULE is what the user typically
// means when they say "every Saturday X" or "all my Y events". propose_delete
// against the master id deletes the whole series; propose_change_category
// against the master id moves every instance to a new calendar.
function mastersBlock(masters: EventCtx[], tz: string): string {
  if (masters.length === 0) return "(no recurring series)";
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return masters
    .map(
      (m) =>
        `- id=${m.id}  RRULE=${m.rrule}  series-start=${fmt(m.start)}  cal=${m.calendar.id} (${m.calendar.name}): ${m.title}`,
    )
    .join("\n");
}

function weekdayCheatSheet(tz: string): string {
  // Concrete dates so the model doesn't have to do day-of-week math.
  const now = new Date();
  const lines: string[] = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(now.getTime() + i * 86400_000);
    const label = d.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    lines.push(`  ${i === 0 ? "today" : i === 1 ? "tomorrow" : "+" + i + "d"}: ${label}`);
  }
  return lines.join("\n");
}

type Cal = {
  id: string;
  name: string;
  isDefault: boolean;
  section: string;
  account: { source: string; label: string };
};

function calendarsBlock(calendars: Cal[]): string {
  const tasks = calendars.filter((c) => c.section === "tasks");
  const sched = calendars.filter(
    (c) =>
      c.section !== "tasks" &&
      !(c.account.source === "google" && GOOGLE_DENYLIST.has(c.account.label)) &&
      c.account.source !== "apple", // Apple is read-only
  );
  const blocked = calendars.filter(
    (c) => c.account.source === "google" && GOOGLE_DENYLIST.has(c.account.label),
  );

  const lines: string[] = [];
  lines.push(`SCHEDULING — for time-blocked events (use these IDs):`);
  if (sched.length === 0) lines.push(`  (none — must auto-create a new task category)`);
  for (const c of sched) {
    lines.push(
      `  - id=${c.id}  "${c.name}"  (${c.account.source}/${c.account.label})${c.isDefault ? "  ⭐ default" : ""}`,
    );
  }
  lines.push(``);
  lines.push(`TASKS — for to-dos (use these IDs, or auto-create a new task category):`);
  if (tasks.length === 0) lines.push(`  (none yet — propose a new category via propose_event with newCategoryName)`);
  for (const c of tasks) {
    lines.push(`  - id=${c.id}  "${c.name}"`);
  }
  if (blocked.length > 0) {
    lines.push(``);
    lines.push(`DO NOT USE these calendars:`);
    for (const c of blocked) {
      lines.push(`  - "${c.name}" (${c.account.label}) — user has explicitly excluded`);
    }
  }
  return lines.join("\n");
}

function systemPrompt(ctx: Awaited<ReturnType<typeof buildContext>>): string {
  const tz = ctx.settings?.timezone ?? "America/Toronto";
  const wh = `${ctx.settings?.workdayStart ?? "09:00"}–${ctx.settings?.workdayEnd ?? "18:00"} ${tz}`;
  const now = new Date();
  const todayLocal = now.toLocaleString("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    `You are a scheduling assistant inside a unified calendar app.`,
    `Current time: ${now.toISOString()} (local: ${todayLocal} in ${tz})`,
    `Default working hours: ${wh}`,
    ``,
    `Week convention:`,
    `- Weeks run SUNDAY → SATURDAY.`,
    `- "this week" / "rest of the week" = today through the upcoming Saturday inclusive.`,
    `- "next week" = the following Sunday → Saturday.`,
    ``,
    `User's active scheduling rules (higher priority first):`,
    rulesBlock(ctx.rules),
    ``,
    `Day-of-week reference (use these EXACT dates when the user names a weekday):`,
    weekdayCheatSheet(tz),
    ``,
    `Available calendars:`,
    calendarsBlock(ctx.calendars as unknown as Cal[]),
    ``,
    `Upcoming non-recurring events (window: 7 days back, 60 days forward):`,
    eventsBlock(ctx.nonRecurring as unknown as EventCtx[], tz),
    ``,
    `Recurring series (use the master id when the user says "all", "every", or "the recurring X"):`,
    mastersBlock(ctx.masters as unknown as EventCtx[], tz),
    ``,
    `Conventions:`,
    `- Reason about times in the user's LOCAL timezone (${tz}). When emitting start/end in propose_event, output ISO-8601 with the correct offset OR UTC Z form — the UI will display them locally.`,
    `- Sanity check: if user says "9 AM" they mean 9 AM ${tz}. In May, ${tz} is UTC-4, so 9 AM local = 13:00 UTC. Confirm by checking against the LOCAL strings above before proposing.`,
    `- NEVER propose a time that overlaps any existing event in the list above. Treat the listed events as immovable unless the user explicitly says to reschedule them.`,
    `- Respect rules strictly. If a rule conflicts with the user's request, surface the conflict.`,
    `- Routine/habit-style requests (stretching, reading, journaling, gym, etc.) → use a TASK category. If a fitting task category already exists (case-insensitive substring match on name OR the user's keyword like "SHAI" matches), reuse it. Otherwise call propose_event with newCategoryName + newCategoryColor.`,
    `- When auto-creating a category, name it after the SUBJECT of the request (e.g. "SHAI Research", "Stretching", "Reading"). Do NOT copy names of existing read-only calendars.`,
    `- Meeting/appointment requests with specific people → use a SCHEDULING calendar that ISN'T in the DO NOT USE list. If none is suitable, fall back to a task category.`,
    `- Never propose events on the DO NOT USE calendars.`,
    `- If multiple recurring instances are needed (e.g. "every weekday at 7am"), use rrule on a single propose_event (FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR, etc.).`,
    `- For requests like "slot N hours" you may emit multiple propose_event calls — each one is independent.`,
    `- "during the week when I don't work" = OUTSIDE working hours (before ${ctx.settings?.workdayStart ?? "09:00"}, after ${ctx.settings?.workdayEnd ?? "18:00"}, or weekend). When in doubt, weekday evenings ${ctx.settings?.workdayEnd ?? "18:00"}–22:00 are the safest default.`,
    `- "during work" / "during my workday" = INSIDE working hours.`,
    `- When slotting around existing events, scan the upcoming events list for a contiguous gap of the requested length. Don't propose anything that overlaps a listed event.`,
    `- "Clear my schedule until X" or "I'm doing Y instead, move my stuff": (a) propose_event for the new activity ('Hanging with friends', etc.) over the requested span, choosing or auto-creating an appropriate category, AND (b) for every event in that span, propose_reschedule into the next reasonable free slot — pack tasks before their implied deadlines, prefer the same week if possible, and don't leave them silently dropped.`,
    `- "What can I do today since X is cancelled" / "maximize my week": look at upcoming non-recurring events as candidate work to pull forward, recommend 2–4 specific items by id, and offer propose_reschedule for any that should move into the freed window.`,
    `- To remove/cancel events the user mentions ("take out X", "remove Y", "cancel Z", "get rid of"), call propose_delete with the eventId from the events list. Pass the title verbatim so the user can verify.`,
    `- "Take out all X on Saturdays" or "remove every X" → if X is in the recurring-series block, propose_delete the MASTER id (this removes the whole series). Don't try to delete one instance at a time.`,
    `- "Change all X to category Y" or "move all X events into category Y" → use propose_change_category. Issue ONE call per matching event (recurring master + each non-recurring instance). Pass either newCalendarId (existing) or newCategoryName (auto-create).`,
    `- Compound requests like "remove X and add Y" should emit BOTH propose_delete AND propose_event — never silently drop the delete.`,
    `- When the user says a weekday ("Saturday", "next Friday"), look up the EXACT date in the Day-of-week reference block above and use that. Do NOT guess.`,
    `- Be concise. If you have enough info, propose slots rather than asking questions.`,
    `- When the user states a new preference ("from now on...", "always...", "never..."), save_rule.`,
    ``,
    `Color hints when auto-creating task categories:`,
    `- Fitness/movement/stretching → #22c55e or #84cc16 (green)`,
    `- Learning/research/reading → #dc2626 (red)`,
    `- Social/personal → #ec4899 (pink)`,
    `- Admin/chores → #7c7c7c (grey)`,
    `- Creative/work → #0ea5e9 (blue)`,
  ].join("\n");
}

async function loadHistory(): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await db.chatMessage.findMany({ orderBy: { createdAt: "asc" }, take: 40 });
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    if (r.role === "user") msgs.push({ role: "user", content: r.content });
    else if (r.role === "assistant") msgs.push({ role: "assistant", content: r.content });
  }
  return msgs;
}

// ── API backend (uses ANTHROPIC_API_KEY) ────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_event",
    description:
      "Suggest a new event for the user to confirm. Does NOT create directly. " +
      "Provide EITHER calendarId (existing) OR newCategoryName (auto-create task category on confirm). " +
      "Use rrule (e.g. FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR) for recurring habits.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        calendarId: { type: "string", description: "Existing calendar id" },
        newCategoryName: {
          type: "string",
          description: "Name of a NEW task category to create instead of using an existing calendar",
        },
        newCategoryColor: {
          type: "string",
          description: "Hex color for the new category (e.g. '#22c55e')",
        },
        allDay: { type: "boolean" },
        rrule: { type: "string" },
        notes: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "propose_reschedule",
    description: "Suggest moving an existing event. Does NOT move directly.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        newStart: { type: "string" },
        newEnd: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["eventId", "newStart", "newEnd"],
    },
  },
  {
    name: "propose_delete",
    description:
      "Suggest deleting an existing event. Use when the user asks to take out, remove, " +
      "cancel, or get rid of an event. The eventId must come from the events list or " +
      "the recurring-series block. For 'every Saturday X' style asks, pass the recurring " +
      "MASTER id — that drops the whole series in one shot. Pass the title verbatim.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        title: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["eventId", "title"],
    },
  },
  {
    name: "propose_change_category",
    description:
      "Suggest changing the calendar/category of an existing local event. Use this when the user " +
      "says 'move X to category Y', 'change all X to Y', or 'recategorize X'. Pass either " +
      "newCalendarId (an existing calendar id) OR newCategoryName (to auto-create on confirm). " +
      "For 'all X events', emit one tool call per matching event including any recurring master.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        title: { type: "string" },
        newCalendarId: { type: "string" },
        newCategoryName: { type: "string" },
        newCategoryColor: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["eventId", "title"],
    },
  },
  {
    name: "save_rule",
    description: "Persist a new scheduling rule.",
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
    description: "Update the default working-hours window.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string" },
        end: { type: "string" },
      },
      required: ["start", "end"],
    },
  },
];

async function backendApi(
  sys: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
): Promise<RawTurn> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing for api backend");
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
    { role: "user", content: userMessage },
  ];

  const model = pickModel(userMessage);
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
    tools: TOOLS,
    messages,
  });

  const turn: RawTurn = { text: "", proposals: [], ruleSaves: [], hourUpdates: [] };
  for (const block of res.content) {
    if (block.type === "text") turn.text += block.text;
    else if (block.type === "tool_use") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = block.input as any;
      if (block.name === "propose_event") {
        turn.proposals.push({ type: "propose_event", ...input });
      } else if (block.name === "propose_reschedule") {
        turn.proposals.push({ type: "propose_reschedule", ...input });
      } else if (block.name === "propose_delete") {
        turn.proposals.push({ type: "propose_delete", ...input });
      } else if (block.name === "propose_change_category") {
        turn.proposals.push({ type: "propose_change_category", ...input });
      } else if (block.name === "save_rule") {
        turn.ruleSaves.push({ text: input.text, priority: Number(input.priority ?? 50) });
      } else if (block.name === "update_working_hours") {
        turn.hourUpdates.push({ start: input.start, end: input.end });
      }
    }
  }
  return turn;
}

// ── CLI backend (uses Claude Code subscription via `claude -p`) ─────────────

const CLI_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "Your reply to the user. Keep it concise.",
    },
    actions: {
      type: "array",
      description: "Side effects to perform. Empty array if none.",
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              type: { const: "propose_event" },
              title: { type: "string" },
              start: { type: "string" },
              end: { type: "string" },
              calendarId: { type: "string" },
              newCategoryName: { type: "string" },
              newCategoryColor: { type: "string" },
              allDay: { type: "boolean" },
              rrule: { type: "string" },
              notes: { type: "string" },
              reasoning: { type: "string" },
            },
            required: ["type", "title", "start", "end"],
          },
          {
            type: "object",
            properties: {
              type: { const: "propose_reschedule" },
              eventId: { type: "string" },
              newStart: { type: "string" },
              newEnd: { type: "string" },
              reasoning: { type: "string" },
            },
            required: ["type", "eventId", "newStart", "newEnd"],
          },
          {
            type: "object",
            properties: {
              type: { const: "propose_delete" },
              eventId: { type: "string" },
              title: { type: "string" },
              reasoning: { type: "string" },
            },
            required: ["type", "eventId", "title"],
          },
          {
            type: "object",
            properties: {
              type: { const: "propose_change_category" },
              eventId: { type: "string" },
              title: { type: "string" },
              newCalendarId: { type: "string" },
              newCategoryName: { type: "string" },
              newCategoryColor: { type: "string" },
              reasoning: { type: "string" },
            },
            required: ["type", "eventId", "title"],
          },
          {
            type: "object",
            properties: {
              type: { const: "save_rule" },
              text: { type: "string" },
              priority: { type: "integer" },
            },
            required: ["type", "text"],
          },
          {
            type: "object",
            properties: {
              type: { const: "update_working_hours" },
              start: { type: "string" },
              end: { type: "string" },
            },
            required: ["type", "start", "end"],
          },
        ],
      },
    },
  },
  required: ["text", "actions"],
};

function flattenHistory(
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
): string {
  if (history.length === 0) return userMessage;
  const past = history.map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`).join("\n\n");
  return `Previous turns (for context only):\n${past}\n\nNEW USER MESSAGE:\n${userMessage}`;
}

async function backendCli(
  sys: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
): Promise<RawTurn> {
  const prompt = flattenHistory(history, userMessage);
  const args = [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--permission-mode", "dontAsk",
    "--model", "sonnet",
    "--max-turns", "5",
    "--system-prompt", sys,
    "--json-schema", JSON.stringify(CLI_SCHEMA),
    prompt,
  ];

  const stdout = await runCli("claude", args, 60_000);

  let envelope: { structured_output?: unknown; result?: string };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI returned non-JSON: ${stdout.slice(0, 300)}`);
  }

  let parsed: { text?: string; actions?: unknown[] } | null = null;
  if (envelope.structured_output && typeof envelope.structured_output === "object") {
    parsed = envelope.structured_output as { text?: string; actions?: unknown[] };
  } else if (typeof envelope.result === "string") {
    const m = envelope.result.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {}
    }
  }
  if (!parsed) throw new Error("claude CLI returned no structured output");

  const turn: RawTurn = { text: parsed.text ?? "", proposals: [], ruleSaves: [], hourUpdates: [] };
  for (const action of parsed.actions ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = action as any;
    if (
      a.type === "propose_event" ||
      a.type === "propose_reschedule" ||
      a.type === "propose_delete" ||
      a.type === "propose_change_category"
    ) {
      turn.proposals.push(a as ToolUse);
    } else if (a.type === "save_rule") {
      turn.ruleSaves.push({ text: a.text, priority: Number(a.priority ?? 50) });
    } else if (a.type === "update_working_hours") {
      turn.hourUpdates.push({ start: a.start, end: a.end });
    }
  }
  return turn;
}

function runCli(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      if (!timedOut) reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ── Public chat() ───────────────────────────────────────────────────────────

export async function chat(userMessage: string): Promise<AssistantTurn> {
  const ctx = await buildContext();
  const sys = systemPrompt(ctx);
  const history = await loadHistory();

  await db.chatMessage.create({ data: { role: "user", content: userMessage } });

  const backend = pickBackend();
  let turn: RawTurn;
  try {
    turn = backend === "cli"
      ? await backendCli(sys, history, userMessage)
      : await backendApi(sys, history, userMessage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.chatMessage.create({
      data: { role: "assistant", content: `Error: ${msg}` },
    });
    throw err;
  }

  // Apply side effects
  let extra = "";
  for (const r of turn.ruleSaves) {
    await db.rule.create({ data: { text: r.text, priority: r.priority } });
    extra += `\n\n_Saved rule: "${r.text}"._`;
  }
  for (const h of turn.hourUpdates) {
    await db.settings.upsert({
      where: { id: "settings" },
      create: { id: "settings", workdayStart: h.start, workdayEnd: h.end },
      update: { workdayStart: h.start, workdayEnd: h.end },
    });
    extra += `\n\n_Working hours set to ${h.start}–${h.end}._`;
  }

  const finalText = (turn.text + extra).trim() || (turn.proposals.length ? "(proposed a slot)" : "");
  await db.chatMessage.create({
    data: {
      role: "assistant",
      content: finalText,
      toolCalls: turn.proposals.length ? JSON.stringify(turn.proposals) : null,
    },
  });

  return { text: finalText, proposals: turn.proposals };
}

export async function reset() {
  await db.chatMessage.deleteMany({});
}
