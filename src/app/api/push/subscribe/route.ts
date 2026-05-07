import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const ua = request.headers.get("user-agent") ?? null;
  const label = guessLabel(ua);
  await db.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: ua,
      label,
    },
    update: {
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: ua,
      label,
    },
  });
  return NextResponse.json({ ok: true });
}

function guessLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isMac = /Macintosh/.test(ua) && !isIos;
  const isAndroid = /Android/.test(ua);
  const browser = /Chrome/.test(ua)
    ? "Chrome"
    : /Firefox/.test(ua)
      ? "Firefox"
      : /Safari/.test(ua)
        ? "Safari"
        : "Browser";
  if (isIos) return `iPhone ${browser}`;
  if (isMac) return `Mac ${browser}`;
  if (isAndroid) return `Android ${browser}`;
  return browser;
}
