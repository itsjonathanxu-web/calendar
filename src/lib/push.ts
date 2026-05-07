import webpush from "web-push";
import { db } from "@/lib/db";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const prv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT ?? "mailto:nobody@example.com";
  if (!pub || !prv) {
    throw new Error("VAPID keys missing — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in env");
  }
  webpush.setVapidDetails(sub, pub, prv);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string; // path to open when user clicks the notification
  tag?: string; // dedupe key — same tag replaces prior notification
  icon?: string;
};

/**
 * Send a push to every registered device. Removes subscriptions that 410/404 from the push service.
 */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  ensureConfigured();
  const subs = await db.pushSubscription.findMany();
  let sent = 0;
  let pruned = 0;
  const body = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        body,
      );
      sent += 1;
      await db.pushSubscription.update({
        where: { id: s.id },
        data: { lastUsedAt: new Date() },
      });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.statusCode;
      if (status === 404 || status === 410) {
        // Endpoint expired — drop it from DB
        await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        pruned += 1;
      } else {
        console.error("[push] send failed:", err);
      }
    }
  }
  return { sent, pruned };
}

export function getPublicVapidKey(): string {
  const pub = process.env.VAPID_PUBLIC_KEY;
  if (!pub) throw new Error("VAPID_PUBLIC_KEY missing");
  return pub;
}
