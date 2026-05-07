"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Send } from "lucide-react";

type Device = {
  id: string;
  label: string | null;
  endpoint: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function PushSettings({
  initialEnabled,
  initialLeadMin,
  initialDevices,
}: {
  initialEnabled: boolean;
  initialLeadMin: number;
  initialDevices: Device[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [leadMin, setLeadMin] = useState(initialLeadMin);
  const [devices, setDevices] = useState(initialDevices);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [thisDeviceSubscribed, setThisDeviceSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setThisDeviceSubscribed(Boolean(sub));
      })
      .catch((err) => console.error("[push] sw register failed:", err));
  }, []);

  async function saveSettings(next: { enabled?: boolean; leadMin?: number }) {
    const fd = new FormData();
    fd.set("remindersEnabled", String(next.enabled ?? enabled));
    fd.set("reminderLeadMin", String(next.leadMin ?? leadMin));
    await fetch("/api/settings/notifications", { method: "POST", body: fd });
  }

  async function subscribeThisDevice() {
    setBusy(true);
    setMsg(null);
    try {
      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        setPermission(p);
        if (p !== "granted") {
          setMsg("Permission denied — enable notifications for this site in your browser settings.");
          return;
        }
      }
      const reg = await navigator.serviceWorker.ready;
      const vapidRes = await fetch("/api/push/vapid");
      const { publicKey } = await vapidRes.json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      });
      const json = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        }),
      });
      setThisDeviceSubscribed(true);
      setMsg("This device is now subscribed.");
      router.refresh();
    } catch (err) {
      setMsg("Failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribeThisDevice() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setThisDeviceSubscribed(false);
      setMsg("This device unsubscribed.");
      router.refresh();
    } catch (err) {
      setMsg("Failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(id: string) {
    const dev = devices.find((d) => d.id === id);
    if (!dev) return;
    if (!confirm(`Remove ${dev.label ?? "this device"}?`)) return;
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: dev.endpoint }),
    });
    setDevices(devices.filter((d) => d.id !== id));
    router.refresh();
  }

  async function sendTest() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "test_failed");
      setMsg(`Sent to ${data.sent} device${data.sent === 1 ? "" : "s"}.`);
    } catch (err) {
      setMsg("Failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Notifications</h2>
        <p className="text-xs text-[var(--color-fg-muted)] mt-1">
          Push notifications across iPhone, iPad, Mac, and PC. Subscribe each device once.
        </p>
      </div>

      {/* Master toggle + lead time */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] divide-y divide-[var(--color-border)]">
        <label className="flex items-center justify-between px-4 py-3 cursor-pointer">
          <div>
            <div className="text-sm font-medium">Meeting reminders</div>
            <div className="text-xs text-[var(--color-fg-muted)]">
              Ping every device this many minutes before each event.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={120}
              value={leadMin}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLeadMin(v);
                saveSettings({ leadMin: v });
              }}
              className="w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-right"
            />
            <span className="text-xs text-[var(--color-fg-muted)]">min before</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                saveSettings({ enabled: e.target.checked });
              }}
              className="ml-2"
            />
          </div>
        </label>

        {/* This device subscribe/unsubscribe */}
        <div className="px-4 py-3">
          {supported === false && (
            <div className="text-xs text-[var(--color-danger)]">
              Push notifications aren&apos;t supported in this browser. On iPhone, add this site to your home screen first.
            </div>
          )}
          {supported && (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                {thisDeviceSubscribed ? (
                  <span className="flex items-center gap-1.5">
                    <Bell size={14} className="text-emerald-500" />
                    This device is subscribed
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <BellOff size={14} className="text-[var(--color-fg-muted)]" />
                    This device is not subscribed
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {thisDeviceSubscribed ? (
                  <button
                    onClick={unsubscribeThisDevice}
                    disabled={busy}
                    className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04]"
                  >
                    Unsubscribe
                  </button>
                ) : (
                  <button
                    onClick={subscribeThisDevice}
                    disabled={busy || permission === "denied"}
                    className="text-xs rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-1.5 font-medium"
                  >
                    Enable on this device
                  </button>
                )}
                {devices.length > 0 && (
                  <button
                    onClick={sendTest}
                    disabled={busy}
                    title="Send a test notification to all subscribed devices"
                    className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04] flex items-center gap-1"
                  >
                    <Send size={11} /> Test
                  </button>
                )}
              </div>
            </div>
          )}
          {permission === "denied" && (
            <div className="mt-2 text-xs text-[var(--color-danger)]">
              Notifications blocked at the browser level. Open the site lock icon → Permissions → Notifications → Allow.
            </div>
          )}
          {msg && <div className="mt-2 text-xs text-[var(--color-fg-muted)]">{msg}</div>}
        </div>

        {/* Subscribed devices list */}
        {devices.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)] mb-2">
              Subscribed devices ({devices.length})
            </div>
            <ul className="space-y-1">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm py-1">
                  <div>
                    <div>{d.label ?? "Unknown device"}</div>
                    <div className="text-[10px] text-[var(--color-fg-muted)]">
                      Added {new Date(d.createdAt).toLocaleDateString()}
                      {d.lastUsedAt && ` · last fired ${new Date(d.lastUsedAt).toLocaleString()}`}
                    </div>
                  </div>
                  <button
                    onClick={() => removeDevice(d.id)}
                    className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-danger)]"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(safe);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
