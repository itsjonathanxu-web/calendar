import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Simple in-memory token bucket per session (or per-IP fallback). 60 writes/min.
// Resets on machine restart, which is fine for a single-user app.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  b.count += 1;
  if (b.count > RATE_LIMIT_MAX) return false;
  return true;
}

function isStateChanging(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = verifySessionToken(token);
  const { pathname } = request.nextUrl;
  const method = request.method;

  // ─── Debug endpoints: require an explicit token in addition to session.
  // Set DEBUG_TOKEN as a Fly secret. Without it, /api/debug/* is unreachable.
  if (pathname.startsWith("/api/debug/")) {
    const expected = process.env.DEBUG_TOKEN;
    if (!expected) {
      return NextResponse.json({ error: "debug_disabled" }, { status: 404 });
    }
    const url = request.nextUrl;
    const provided = url.searchParams.get("token") ?? request.headers.get("x-debug-token");
    if (provided !== expected) {
      return NextResponse.json({ error: "debug_token_invalid" }, { status: 403 });
    }
    // Skip other middleware (auth/CSRF/rate-limit) — debug endpoints are
    // admin-tier and meant to be hit directly.
    return NextResponse.next();
  }

  // ─── Auth gate
  if (authed && pathname === "/login") {
    return NextResponse.redirect(new URL("/calendar", request.url));
  }
  if (!authed && pathname !== "/login") {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ─── CSRF: state-changing requests must come from the same origin.
  // Browsers always send Origin on POST/PUT/etc., and Origin is on the
  // Forbidden Header list — cross-origin attackers can't spoof it.
  if (isStateChanging(method)) {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    const host = request.headers.get("host");
    const proto =
      request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    const expectedOrigin = host ? `${proto}://${host}` : null;
    const ok =
      (origin && expectedOrigin && origin === expectedOrigin) ||
      (referer && expectedOrigin && referer.startsWith(expectedOrigin + "/"));
    if (!ok) {
      return NextResponse.json({ error: "csrf_origin_mismatch" }, { status: 403 });
    }

    // ─── Rate limit writes
    const limitKey =
      token ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "anon";
    if (!rateLimit(limitKey)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals, static files, and the login/logout
  // endpoints (which must be reachable while logged out).
  matcher: ["/((?!_next|favicon.ico|api/auth|.*\\..*).*)"],
};
