import Anthropic from "@anthropic-ai/sdk";
import { addDays } from "date-fns";
import { db } from "@/lib/db";

const MODEL = "claude-sonnet-4-6";

export type ToolUse =
  | {
      type: "propose_event";
      title: string;
      start: string;
      end: string;
      calendarId: string;
      allDay?: boolean;
      notes?: string;
      reasoning?: string;
    }
  | {
      type: "propose_reschedule";
      eventId: string;
      newStart: string;
      newEnd: string;
      reasoning?: string;
    };

export type AssistantTurn = {
  text: string;
  proposals: ToolUse[];
};

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing in .env");
  return new Anthropic({ apiKey: key });
}

async function buildContext() {
  const [rules, settings, calendars, events] = await Promise.all([
    db.rule.findMany({ where: { active: true }, orderBy: { priority: "desc" } }),
    db.settings.findUnique({ where: { id: "settings" } }),
    db.calendar.findMany({
      where: { account: { source: "google" } },
      include: { account: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    db.event.findMany({
      where: {
        start: { gte: new Date() },
        end: { lte: addDays(new Date(), 14) },
        calendar: { enabled: true },
      },
      include: { calendar: { include: { account: true } } },
      orderBy: { start: "asc" },
    }),
  ]);

  return { rules, settings, calendars, events };
}

function rulesBlock(rules: { text: string; priority: number }[]): string {
  if (rules.length === 0) return "(no rules yet — Claude can call save_rule when the user states a preference)";
  return rules.map((r) => `- [${r.priority}] ${r.text}`).join("\n");
}

function eventsBlock(
  events: { title: string; start: Date; end: Date; calendar: { name: string } }[],
): string {
  if (events.length === 0) return "(calendar is empty for the next 14 days)";
  return events
    .map(
      (e) =>
        `- ${e.start.toISOString()} → ${e.end.toISOString()}  ${e.calendar.name}: ${e.title}`,
    )
    .join("\n");
}

function calendarsBlock(
  calendars: { id: string; name: string; isDefault: boolean; account: { label: string } }[],
): string {
  return calendars
    .map((c) => `- id=${c.id}  "${c.name}" (${c.account.label})${c.isDefault ? "  ⭐ default" : ""}`)
    .join("\n");
}

function systemPrompt(ctx: Awaited<ReturnType<typeof buildContext>>): string {
  const tz = ctx.settings?.timezone ?? "America/Toronto";
  const wh = `${ctx.settings?.workdayStart ?? "09:00"}–${ctx.settings?.workdayEnd ?? "18:00"} ${tz}`;
  const now = new Date().toISOString();
  return [
    `You are a scheduling assistant inside a unified calendar app.`,
    `Current time: ${now}`,
    `Default working hours: ${wh}`,
    ``,
    `User's active scheduling rules (higher priority first):`,
    rulesBlock(ctx.rules),
    ``,
    `Writable calendars (use one of these IDs when proposing events):`,
    calendarsBlock(ctx.calendars),
    ``,
    `Upcoming events (next 14 days):`,
    eventsBlock(ctx.events),
    ``,
    `Conventions:`,
    `- All times are ISO-8601 with timezone offset.`,
    `- Respect the rules above strictly. If a rule conflicts with the user's request, surface the conflict.`,
    `- When proposing an event, prefer the calendar marked ⭐ default unless the user names another.`,
    `- Be concise. If you have enough info, propose a slot rather than asking questions.`,
    `- When the user states a new preference ("from now on...", "always...", "never..."), call save_rule.`,
  ].join("\n");
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_event",
    description:
      "Suggest creating a new event for the user to confirm. Does NOT create it directly.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "ISO-8601 date-time" },
        end: { type: "string", description: "ISO-8601 date-time" },
        calendarId: { type: "string", description: "id of the writable calendar" },
        allDay: { type: "boolean" },
        notes: { type: "string" },
        reasoning: { type: "string", description: "Brief why-this-slot for the user." },
      },
      required: ["title", "start", "end", "calendarId"],
    },
  },
  {
    name: "propose_reschedule",
    description: "Suggest moving an existing event to a new time. Does NOT move it directly.",
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
    name: "save_rule",
    description:
      "Persist a new scheduling rule the user just stated (e.g. 'no meetings before 10am').",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        priority: { type: "integer", description: "0–100; higher applies first" },
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
        start: { type: "string", description: "HH:mm" },
        end: { type: "string", description: "HH:mm" },
      },
      required: ["start", "end"],
    },
  },
];

async function loadHistory(): Promise<Anthropic.MessageParam[]> {
  const rows = await db.chatMessage.findMany({
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  // Convert stored rows into Anthropic-shaped messages.
  // Tool results aren't replayed in v1 — we only keep user/assistant text turns.
  const msgs: Anthropic.MessageParam[] = [];
  for (const r of rows) {
    if (r.role === "user") msgs.push({ role: "user", content: r.content });
    else if (r.role === "assistant") msgs.push({ role: "assistant", content: r.content });
  }
  return msgs;
}

export async function chat(userMessage: string): Promise<AssistantTurn> {
  const ctx = await buildContext();
  const client = getClient();
  const sys = systemPrompt(ctx);
  const history = await loadHistory();

  await db.chatMessage.create({
    data: { role: "user", content: userMessage },
  });

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: sys,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: TOOLS,
    messages,
  });

  const proposals: ToolUse[] = [];
  let text = "";

  for (const block of res.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = block.input as any;
      if (block.name === "propose_event") {
        proposals.push({
          type: "propose_event",
          title: input.title,
          start: input.start,
          end: input.end,
          calendarId: input.calendarId,
          allDay: input.allDay,
          notes: input.notes,
          reasoning: input.reasoning,
        });
      } else if (block.name === "propose_reschedule") {
        proposals.push({
          type: "propose_reschedule",
          eventId: input.eventId,
          newStart: input.newStart,
          newEnd: input.newEnd,
          reasoning: input.reasoning,
        });
      } else if (block.name === "save_rule") {
        await db.rule.create({
          data: { text: input.text, priority: Number(input.priority ?? 50) },
        });
        text += `\n\n_Saved rule: "${input.text}"._`;
      } else if (block.name === "update_working_hours") {
        await db.settings.upsert({
          where: { id: "settings" },
          create: { id: "settings", workdayStart: input.start, workdayEnd: input.end },
          update: { workdayStart: input.start, workdayEnd: input.end },
        });
        text += `\n\n_Working hours set to ${input.start}–${input.end}._`;
      }
    }
  }

  const summary = text.trim() || (proposals.length ? "(proposed a slot)" : "");
  await db.chatMessage.create({
    data: {
      role: "assistant",
      content: summary,
      toolCalls: proposals.length ? JSON.stringify(proposals) : null,
    },
  });

  return { text: summary, proposals };
}

export async function reset() {
  await db.chatMessage.deleteMany({});
}
