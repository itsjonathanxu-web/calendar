"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";

const items = [
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-elev)] flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        <div className="text-sm font-semibold tracking-tight">Calendar</div>
        <div className="text-xs text-[var(--color-fg-muted)]">Notion · Google · Apple</div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-[var(--color-fg)]/[0.06] text-[var(--color-fg)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-fg)]/[0.04]",
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
      <form action="/api/auth/logout" method="post" className="p-2 border-t border-[var(--color-border)]">
        <button
          type="submit"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-fg)]/[0.04]"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </form>
    </aside>
  );
}
