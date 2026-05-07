import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = verifySessionToken(token);
  const { pathname } = request.nextUrl;

  if (authed && pathname === "/login") {
    return NextResponse.redirect(new URL("/calendar", request.url));
  }

  if (!authed && pathname !== "/login") {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals, static files, and auth endpoints
  matcher: ["/((?!_next|favicon.ico|api/auth|.*\\..*).*)"],
};
