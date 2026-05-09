import { Trash2 } from "lucide-react";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { isGoogleConfigured } from "@/lib/sources/google";
import { formatDistanceToNow } from "date-fns";
import { PushSettings } from "@/components/PushSettings";
import { RemindersCRUD, type ReminderRow } from "@/components/RemindersCRUD";
import { FeedUrlField } from "@/components/FeedUrlField";

const messages: Record<string, { kind: "ok" | "err"; text: string }> = {
  google_not_configured: {
    kind: "err",
    text: "Google OAuth not configured — set GOOGLE_CLIENT_ID/SECRET in .env.",
  },
  google_state_mismatch: { kind: "err", text: "OAuth state mismatch — try connecting again." },
  google_exchange_failed: { kind: "err", text: "Could not exchange the OAuth code." },
  google_sync_failed: { kind: "err", text: "Google sync failed — check the server log." },
  google_access_denied: { kind: "err", text: "You declined the Google permission prompt." },
  notion_bad_token: {
    kind: "err",
    text: "Token must start with ntn_ or secret_ — paste the integration token from notion.so/profile/integrations.",
  },
  notion_connect_failed: {
    kind: "err",
    text: "Notion rejected the token. Make sure the integration is shared with at least one database.",
  },
  notion_sync_failed: { kind: "err", text: "Notion sync failed — check the server log." },
  apple_retired: {
    kind: "err",
    text: "Apple iCloud sync has been retired. Use the read-only feed in Calendar feed instead.",
  },
  not_found: { kind: "err", text: "Account not found." },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    disconnected?: string;
    synced?: string;
    count?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const accounts = await db.account.findMany({
    orderBy: { createdAt: "asc" },
    include: { calendars: { orderBy: { name: "asc" } } },
  });

  const banner = (() => {
    if (sp.error) {
      const m = messages[sp.error];
      return m ? m : { kind: "err" as const, text: sp.error };
    }
    if (sp.connected) {
      const detail = sp.count ? ` — ${sp.count}` : "";
      return { kind: "ok" as const, text: `Connected to ${sp.connected}${detail}.` };
    }
    if (sp.disconnected) return { kind: "ok" as const, text: `Disconnected ${sp.disconnected}.` };
    if (sp.synced)
      return {
        kind: "ok" as const,
        text: `Synced ${sp.synced}${sp.count ? ` — ${sp.count} events` : ""}.`,
      };
    return null;
  })();

  const googleReady = isGoogleConfigured();
  const googleAccounts = accounts.filter((a) => a.source === "google");
  const notionAccounts = accounts.filter((a) => a.source === "notion");
  const appleAccounts = accounts.filter((a) => a.source === "apple");

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          Connect calendar sources, manage scheduling rules, set working hours.
        </p>
      </header>

      {banner && (
        <div
          className={
            "rounded-lg border px-4 py-2 text-sm " +
            (banner.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200")
          }
        >
          {banner.text}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Google Calendar</h2>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] divide-y divide-[var(--color-border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm font-medium">Connect a Google account</div>
              <div className="text-xs text-[var(--color-fg-muted)]">
                {googleReady
                  ? "OAuth is ready. Click Connect to grant calendar access."
                  : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first."}
              </div>
            </div>
            <a
              href="/api/sources/google/connect"
              className={
                "text-xs rounded-md border px-3 py-1.5 " +
                (googleReady
                  ? "border-[var(--color-border)] hover:bg-[var(--color-fg)]/[0.04]"
                  : "border-[var(--color-border)] text-[var(--color-fg-muted)] pointer-events-none opacity-60")
              }
            >
              Connect
            </a>
          </div>
          {googleAccounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </div>
        {!googleReady && <GoogleSetupHelp />}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Notion</h2>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] divide-y divide-[var(--color-border)]">
          <form action="/api/sources/notion/connect" method="post" className="px-4 py-3 space-y-2">
            <label className="block text-sm font-medium">Integration token</label>
            <div className="flex gap-2">
              <input
                type="password"
                name="token"
                placeholder="ntn_..."
                required
                className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm font-mono"
              />
              <button
                type="submit"
                className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04]"
              >
                Connect
              </button>
            </div>
            <p className="text-xs text-[var(--color-fg-muted)]">
              Create an integration at{" "}
              <a
                className="underline"
                target="_blank"
                rel="noreferrer"
                href="https://www.notion.so/profile/integrations"
              >
                notion.so/profile/integrations
              </a>
              , then share it with each database you want pulled in (Tasks, Action Plans, Goals, etc.).
              Any database with a date property auto-imports — anything dated lands on the calendar.
            </p>
          </form>
          {notionAccounts.map((a) => (
            <AccountRow key={a.id} account={a} withCalendarToggles />
          ))}
        </div>
      </section>

      {appleAccounts.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Apple Calendar (iCloud) — retired</h2>
            <p className="text-xs text-[var(--color-fg-muted)] mt-1">
              Two-way iCloud sync is no longer supported. Use the read-only feed above to
              mirror this app into iOS Calendar instead. Disconnect any leftover account
              after running the May migration in Admin.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] divide-y divide-[var(--color-border)]">
            {appleAccounts.map((a) => (
              <AccountRow key={a.id} account={a} withCalendarToggles />
            ))}
          </div>
        </section>
      )}

      <CalendarFeedSection />
      <NotificationsSection />
      <RemindersSection />
      <WorkingHoursSection />
      <RulesSection />
    </div>
  );
}

async function CalendarFeedSection() {
  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : "";
  const token = settings?.feedToken ?? null;
  const url = token ? `${origin}/api/feed.ics?token=${token}` : null;
  // iCloud needs webcal:// to auto-open the subscribe sheet on iOS/macOS.
  const webcalUrl = url ? url.replace(/^https?:\/\//, "webcal://") : null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Calendar feed (subscribe)</h2>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          Paste this URL into iCloud / iPhone Calendar to mirror everything you schedule
          here, read-only. Updates flow out within ~1 hour (Apple polls subscriptions).
        </p>
      </div>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 space-y-3">
        {!token ? (
          <form action="/api/settings/feed-token" method="post">
            <input type="hidden" name="action" value="ensure" />
            <button
              type="submit"
              className="text-xs rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-1.5 font-medium"
            >
              Generate subscription URL
            </button>
          </form>
        ) : (
          <>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-fg-muted)]">HTTPS URL</label>
              <FeedUrlField url={url ?? ""} />
            </div>
            {webcalUrl && (
              <div className="space-y-1">
                <label className="block text-xs text-[var(--color-fg-muted)]">
                  webcal:// (tap on iPhone to subscribe automatically)
                </label>
                <FeedUrlField url={webcalUrl} />
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-[var(--color-fg-muted)]">
                Anyone with this URL can read your calendar. Rotate to invalidate the old one.
              </p>
              <form action="/api/settings/feed-token" method="post">
                <input type="hidden" name="action" value="rotate" />
                <button
                  type="submit"
                  className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04]"
                >
                  Rotate token
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

async function NotificationsSection() {
  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  const devices = await db.pushSubscription.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <PushSettings
      initialEnabled={settings?.remindersEnabled ?? true}
      initialLeadMin={settings?.reminderLeadMin ?? 15}
      initialDevices={devices.map((d) => ({
        id: d.id,
        label: d.label,
        endpoint: d.endpoint,
        createdAt: d.createdAt.toISOString(),
        lastUsedAt: d.lastUsedAt ? d.lastUsedAt.toISOString() : null,
      }))}
    />
  );
}

async function RemindersSection() {
  const reminders = await db.reminder.findMany({ orderBy: { dueAt: "asc" } });
  const initial: ReminderRow[] = reminders.map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueAt: r.dueAt.toISOString(),
    rrule: r.rrule,
    enabled: r.enabled,
    lastFiredAt: r.lastFiredAt ? r.lastFiredAt.toISOString() : null,
  }));
  return <RemindersCRUD initial={initial} />;
}

async function WorkingHoursSection() {
  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Working hours</h2>
      <form
        action="/api/settings/working-hours"
        method="post"
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto] gap-3"
      >
        <label className="block text-xs text-[var(--color-fg-muted)]">
          Start
          <input
            type="time"
            name="workdayStart"
            defaultValue={settings?.workdayStart ?? "09:00"}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs text-[var(--color-fg-muted)]">
          End
          <input
            type="time"
            name="workdayEnd"
            defaultValue={settings?.workdayEnd ?? "18:00"}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs text-[var(--color-fg-muted)]">
          Timezone
          <input
            type="text"
            name="timezone"
            defaultValue={settings?.timezone ?? "America/Toronto"}
            placeholder="America/Toronto"
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <button
          type="submit"
          className="text-xs rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-4 py-1.5 font-medium self-end"
        >
          Save
        </button>
      </form>
    </section>
  );
}

async function RulesSection() {
  const rules = await db.rule.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Scheduling rules</h2>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          Claude reads these every time you say &ldquo;slot in&rdquo;. Higher priority applies first.
        </p>
      </div>
      <form
        action="/api/rules/create"
        method="post"
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 grid grid-cols-[1fr_80px_auto] gap-2"
      >
        <input
          name="text"
          placeholder="e.g. no meetings before 10am"
          required
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
        />
        <input
          type="number"
          name="priority"
          defaultValue={50}
          min={0}
          max={100}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04]"
        >
          Add rule
        </button>
      </form>
      {rules.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-muted)]">
          No rules yet. Tell the chat &ldquo;from now on, no meetings before 10am&rdquo; and Claude will save it.
        </p>
      ) : (
        <ul className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] divide-y divide-[var(--color-border)]">
          {rules.map((r) => (
            <li key={r.id} className="px-4 py-2 flex items-center gap-3">
              <span
                className={
                  "text-[10px] font-mono rounded px-1.5 py-0.5 " +
                  (r.active
                    ? "bg-[var(--color-accent)]/[0.1] text-[var(--color-accent)]"
                    : "bg-[var(--color-fg)]/[0.06] text-[var(--color-fg-muted)]")
                }
              >
                {r.priority}
              </span>
              <span className={"flex-1 text-sm " + (r.active ? "" : "line-through text-[var(--color-fg-muted)]")}>
                {r.text}
              </span>
              <form action="/api/rules/toggle" method="post">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                <button
                  type="submit"
                  className="text-[11px] rounded px-2 py-0.5 border border-[var(--color-border)]"
                >
                  {r.active ? "Active" : "Off"}
                </button>
              </form>
              <form action="/api/rules/delete" method="post">
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  className="text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] p-1.5 rounded hover:bg-[var(--color-danger)]/[0.08]"
                >
                  <Trash2 size={14} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountRow({
  account,
  withCalendarToggles = false,
}: {
  account: Awaited<ReturnType<typeof db.account.findMany>>[number] & {
    calendars: { id: string; name: string; color: string; enabled: boolean }[];
  };
  withCalendarToggles?: boolean;
}) {
  const a = account;
  const enabledCount = a.calendars.filter((c) => c.enabled).length;
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm">{a.label}</div>
          <div className="text-xs text-[var(--color-fg-muted)]">
            {a.calendars.length} calendar{a.calendars.length === 1 ? "" : "s"}
            {withCalendarToggles && ` · ${enabledCount} on`}
            {a.lastSyncAt
              ? ` · synced ${formatDistanceToNow(a.lastSyncAt, { addSuffix: true })}`
              : " · never synced"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <form action={`/api/sources/${a.source}/sync`} method="post">
            <input type="hidden" name="accountId" value={a.id} />
            <button
              type="submit"
              className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04]"
            >
              Sync
            </button>
          </form>
          <form action={`/api/sources/${a.source}/disconnect`} method="post">
            <input type="hidden" name="accountId" value={a.id} />
            <button
              type="submit"
              className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/[0.06]"
            >
              Disconnect
            </button>
          </form>
        </div>
      </div>

      {withCalendarToggles && a.calendars.length > 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 space-y-0.5 max-h-64 overflow-auto">
          {a.calendars.map((c) => (
            <form
              key={c.id}
              action="/api/calendars/toggle"
              method="post"
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--color-fg)]/[0.04]"
            >
              <input type="hidden" name="calendarId" value={c.id} />
              <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: c.color }}
              />
              <span className="text-sm flex-1 truncate">{c.name}</span>
              <button
                type="submit"
                className={
                  "text-[11px] rounded px-2 py-0.5 " +
                  (c.enabled
                    ? "bg-[var(--color-fg)]/[0.08] text-[var(--color-fg)]"
                    : "border border-[var(--color-border)] text-[var(--color-fg-muted)]")
                }
              >
                {c.enabled ? "Tracking" : "Off"}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

function GoogleSetupHelp() {
  return (
    <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-3 text-xs text-[var(--color-fg-muted)]">
      <summary className="cursor-pointer text-[var(--color-fg)]">
        How to set up Google OAuth
      </summary>
      <ol className="list-decimal ml-5 mt-2 space-y-1 leading-relaxed">
        <li>
          Open{" "}
          <a className="underline" href="https://console.cloud.google.com" target="_blank" rel="noreferrer">
            Google Cloud Console
          </a>{" "}
          → create a project.
        </li>
        <li>
          APIs &amp; Services → Library → enable{" "}
          <span className="font-mono">Google Calendar API</span>.
        </li>
        <li>OAuth consent screen → External → add yourself as a test user.</li>
        <li>
          Credentials → Create OAuth client ID → Web application → add{" "}
          <span className="font-mono">http://localhost:3000/api/sources/google/callback</span> as
          Authorized redirect URI.
        </li>
        <li>
          Copy the client ID + secret into <span className="font-mono">.env</span>:
          <pre className="mt-1 rounded bg-[var(--color-fg)]/[0.04] p-2 text-[10px] leading-snug">{`GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."`}</pre>
        </li>
        <li>Restart the dev server, then click Connect.</li>
      </ol>
    </details>
  );
}
