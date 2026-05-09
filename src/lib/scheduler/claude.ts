import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { addDays } from "date-fns";
import { db } from "@/lib/db";
import { TOOLS as ALL_TOOLS, runTool, type AppliedEntry } from "./tools";

const SONNET_MODEL = "claude-sonnet-4-6";
const HAIKU_MODEL = "claude-haiku-4-5";

// Route simple slot/add requests to Haiku (~15× cheaper) and reserve Sonnet
// for messages that imply multi-event constraint solving (move, reschedule,
// shift, push around). Anchor on intent keywords; if anything cascade-y is
// mentioned, take the Sonnet path even if the rest of the message is short.
function pickModel(userMessage: string): string {
  const msg = userMessage.toLowerCase();
  // Only escalate to Sonnet for genuinely cascade-y intent — multi-event ops,
  // bulk recategorize, or "clear and reschedule" patterns. Single delete /
  // single move stays on Haiku (15× cheaper, plenty smart for one event).
  const cascadeRx =
    /\b(all (my )?(events?|tasks?|chinese|claude|workouts?)|every (saturday|sunday|monday|tuesday|wednesday|thursday|friday|weekday|weekend|day|week|other)|rearrang|recategoriz|change all|move all|move every|clear (my )?(schedule|day|today|tomorrow)|fit (around|in)|reschedule|swap|push (back|out|up|over))\b/;
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
      newTitle?: string;
      reasoning?: string;
    };

export type AssistantTurn = {
  text: string;
  // New shape: server-side execution returns the changes that were applied,
  // not proposals to confirm. The chat panel renders these as a colored
  // summary and registers undo entries from the snapshot data.
  applied: AppliedEntry[];
  // Legacy shape kept for the CLI backend which still emits client-side
  // proposals — empty when using the API backend.
  proposals: ToolUse[];
};

type RawTurn = {
  text: string;
  proposals: ToolUse[];
  applied: AppliedEntry[];
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

// Static block — identical across every turn so the prompt cache hits 100%
// after the first call (ephemeral cache TTL = 5 min). No dates, no events,
// no rules — those go in the dynamic block below.
const STATIC_PROMPT = [
  `You are a scheduling assistant inside a unified calendar app. Every tool call you make is EXECUTED IMMEDIATELY — no user confirmation step. The user trusts you and ⌘Z reverses anything.`,
  ``,
  `Read tools (call these BEFORE acting when info is missing):`,
  `- describe_availability(days?) — returns free time slots day-by-day with insideWorkHours flags. Use before any "find me time for X" or "what can I do today" ask.`,
  `- find_events(query, days?) — fuzzy search by title substring. Use BEFORE bulk ops to ensure you have every matching id (don't trust the upcoming-events list to be exhaustive past its window).`,
  `- list_categories — every category id+name+color+section. Use to resolve "the AI Development calendar" → calendar id.`,
  ``,
  `Action tools (mutate; each call is final):`,
  `- propose_event — create one event. Pass calendarId or newCategoryName. Use rrule for recurring (FREQ=WEEKLY;BYDAY=SA;UNTIL=YYYYMMDDT235959Z).`,
  `- propose_update_event — change ANY field of an existing event (newTitle, newStart+newEnd, newCalendarId, newCategoryName, newNotes, newRrule, newAllDay). One call per event. Replaces the older propose_reschedule + propose_change_category.`,
  `- propose_delete — remove an event. For "every Saturday X" / "all my Y": pass the MASTER id (cascades to all instances).`,
  `- propose_split_event — break an event into N pieces with optional gaps.`,
  `- propose_clone_event — duplicate an event at a new start time.`,
  `- propose_create_category — make a new category with no event attached.`,
  `- propose_update_category — rename/recolor a category.`,
  `- propose_delete_category — wipe a category and all its events (destructive — only when explicit).`,
  `- propose_archive_completed — confirm archive of completed tasks.`,
  `- save_rule — persist a stated preference.`,
  `- update_working_hours — change the workday window.`,
  ``,
  `Week convention:`,
  `- Weeks run SUNDAY → SATURDAY.`,
  `- "this week" = today through Saturday inclusive. "next week" = the following Sun→Sat.`,
  ``,
  `General conventions:`,
  `- Reason about times in the user's LOCAL timezone. Emit ISO-8601 with offset or UTC Z; the UI displays locally.`,
  `- NEVER propose a time that overlaps any existing event listed in the dynamic block (or that describe_availability shows as busy). Treat listed events as immovable unless the user explicitly says reschedule them.`,
  `- Respect active rules. Surface conflicts instead of silently violating them.`,
  `- Routine/habit-style asks (stretching, reading, gym) → use or auto-create a TASK category.`,
  `- Auto-created category names follow the SUBJECT (e.g. "Stretching"). Don't copy read-only calendar names.`,
  `- Meeting/appointment with specific people → use a writable SCHEDULING calendar (not in DO NOT USE).`,
  `- Never propose events on DO NOT USE calendars.`,
  `- "every weekday at 7am" → ONE propose_event with rrule (FREQ=DAILY or FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR).`,
  `- "every Saturday in May 8-10pm" → ONE propose_event with rrule FREQ=WEEKLY;BYDAY=SA;UNTIL=20260531T235959Z. NOT 4 separate non-recurring events.`,
  `- "slot N hours" → call describe_availability first, then emit propose_event into the picked slot(s).`,
  `- "during the week when I don't work" = OUTSIDE working hours OR weekend. Weekday evenings after workdayEnd are the safest default.`,
  `- "Clear my schedule until X / I'm doing Y instead": (a) propose_event for the new activity over the requested span, AND (b) call find_events for the displaced events, then propose_update_event each one to a free slot from describe_availability. Don't silently drop.`,
  `- "What can I do today since X is cancelled" / "maximize my week": call describe_availability for today + find_events for upcoming priorities, propose 2–4 specific propose_update_event calls to pull items forward.`,
  `- Single-event remove ("take out X") → propose_delete.`,
  `- "Every Saturday X" / "all my X" → propose_delete on the recurring MASTER id (cascades).`,
  `- "Change all X to category Y" → call find_events first if needed, then ONE propose_update_event per matching event (recurring master + each non-recurring instance). Set newCalendarId or newCategoryName + newCategoryColor.`,
  `- "Rename all X to Z" → ONE propose_update_event per match with newTitle=Z. Combine with newCalendarId in the same call when the user says rename AND recategorize.`,
  `- "Remove the (number) suffix from all X" → propose_update_event with newTitle = cleaned-up title for EVERY match.`,
  `- For compound asks ("change A and add B and remove C"), enumerate every event for every clause. Completeness > brevity.`,
  `- When the user names a weekday, use the exact date from the day-of-week block. Don't guess.`,
  `- Be concise in your text response — the summary card already shows what changed.`,
  `- When the user states a new preference ("from now on…", "always…"), save_rule.`,
  ``,
  `Color hints when auto-creating categories:`,
  `- Fitness/movement → #22c55e or #84cc16`,
  `- Learning/research → #dc2626`,
  `- Social/personal → #ec4899`,
  `- Admin/chores → #7c7c7c`,
  `- Creative/work → #0ea5e9`,
].join("\n");

function dynamicPrompt(ctx: Awaited<ReturnType<typeof buildContext>>): string {
  const tz = ctx.settings?.timezone ?? "America/Toronto";
  const wh = `${ctx.settings?.workdayStart ?? "09:00"}–${ctx.settings?.workdayEnd ?? "18:00"} ${tz}`;
  const now = new Date();
  const todayLocal = now.toLocaleString("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return [
    `Current time: ${now.toISOString()} (local: ${todayLocal} in ${tz})`,
    `Default working hours: ${wh}`,
    ``,
    `Active scheduling rules (priority desc):`,
    rulesBlock(ctx.rules),
    ``,
    `Day-of-week reference (use these EXACT dates):`,
    weekdayCheatSheet(tz),
    ``,
    `Available calendars:`,
    calendarsBlock(ctx.calendars as unknown as Cal[]),
    ``,
    `Upcoming non-recurring events (±7d back, +60d forward):`,
    eventsBlock(ctx.nonRecurring as unknown as EventCtx[], tz),
    ``,
    `Recurring series (use master id for "all/every"):`,
    mastersBlock(ctx.masters as unknown as EventCtx[], tz),
  ].join("\n");
}

async function loadHistory(): Promise<{ role: "user" | "assistant"; content: string }[]> {
  // Trimmed from 40 → 12 to slash input tokens. The system prompt already
  // carries enough context (rules, events, calendars) that the model rarely
  // needs more than the last few turns of conversation.
  const rows = await db.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows.reverse()) {
    if (r.role === "user") msgs.push({ role: "user", content: r.content });
    else if (r.role === "assistant") msgs.push({ role: "assistant", content: r.content });
  }
  return msgs;
}

// ── API backend: agentic loop with server-side tool execution ──────────────

const MAX_LOOP_ITERATIONS = 6;

async function backendApi(
  staticSys: string,
  dynamicSys: string,
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

  const turn: RawTurn = {
    text: "",
    proposals: [],
    applied: [],
    ruleSaves: [],
    hourUpdates: [],
  };

  // The model picks read tools (describe_availability, find_events, etc.) and
  // mutation tools (propose_event, propose_update_event, etc.). We loop until
  // it stops asking for tool calls — at most MAX_LOOP_ITERATIONS to bound cost.
  // First model pick happens once based on the user message; subsequent
  // iterations re-use the same model so cache stays warm.
  const model = pickModel(userMessage);

  for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      system: [
        { type: "text", text: staticSys, cache_control: { type: "ephemeral" } },
        { type: "text", text: dynamicSys, cache_control: { type: "ephemeral" } },
      ],
      tools: ALL_TOOLS,
      messages,
    });

    // Collect text from this turn (may be partial on tool_use turns).
    for (const block of res.content) {
      if (block.type === "text") turn.text += block.text;
    }

    const toolUses = res.content.filter((b) => b.type === "tool_use") as Array<
      Extract<(typeof res.content)[number], { type: "tool_use" }>
    >;

    if (toolUses.length === 0 || res.stop_reason !== "tool_use") {
      // No more tools — the model is done.
      return turn;
    }

    // Echo the assistant's full response back into messages so the next
    // request includes the tool_use blocks that the tool_results refer to.
    messages.push({ role: "assistant", content: res.content });

    // Run each tool, collect tool_results to feed back as the next user turn.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await runTool(tu.name, tu.input);
      if (result.applied) turn.applied.push(result.applied);
      // Mirror rule saves / hour updates into the legacy fields too so
      // chat() can still surface them in the assistant's text suffix.
      if (result.applied?.kind === "rule_saved") {
        turn.ruleSaves.push({
          text: result.applied.text,
          priority: result.applied.priority,
        });
      }
      if (result.applied?.kind === "working_hours_updated") {
        turn.hourUpdates.push({
          start: result.applied.newStart,
          end: result.applied.newEnd,
        });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result.toolResult),
        is_error: Boolean(result.error),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Hit the iteration cap — return what we have, with a note in the text.
  if (turn.text.trim().length === 0) {
    turn.text = "(stopped after the maximum tool-call loop — re-prompt if more is needed)";
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
              newTitle: { type: "string" },
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

  const turn: RawTurn = { text: parsed.text ?? "", proposals: [], applied: [], ruleSaves: [], hourUpdates: [] };
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
  const dynamicSys = dynamicPrompt(ctx);
  const history = await loadHistory();

  await db.chatMessage.create({ data: { role: "user", content: userMessage } });

  const backend = pickBackend();
  let turn: RawTurn;
  try {
    turn = backend === "cli"
      ? await backendCli(`${STATIC_PROMPT}\n\n${dynamicSys}`, history, userMessage)
      : await backendApi(STATIC_PROMPT, dynamicSys, history, userMessage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.chatMessage.create({
      data: { role: "assistant", content: `Error: ${msg}` },
    });
    throw err;
  }

  // The API backend already applied rule saves / hour updates via its tool
  // executors. The CLI backend still surfaces them in ruleSaves/hourUpdates,
  // so apply those for back-compat. (The CLI path doesn't use the agentic
  // loop and returns proposals to the client to apply.)
  let extra = "";
  if (backend === "cli") {
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
  }

  const fallbackText =
    turn.applied.length > 0 ? "(done — see summary)" : turn.proposals.length ? "(proposed a slot)" : "";
  const finalText = (turn.text + extra).trim() || fallbackText;
  await db.chatMessage.create({
    data: {
      role: "assistant",
      content: finalText,
      toolCalls:
        turn.applied.length > 0
          ? JSON.stringify(turn.applied)
          : turn.proposals.length
            ? JSON.stringify(turn.proposals)
            : null,
    },
  });

  return { text: finalText, applied: turn.applied, proposals: turn.proposals };
}

export async function reset() {
  await db.chatMessage.deleteMany({});
}
