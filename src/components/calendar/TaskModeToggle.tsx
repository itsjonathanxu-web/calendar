"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { CheckSquare } from "lucide-react";
import { cn } from "@/lib/cn";

// Toggle Task Mode via URL param. Visible only on /calendar?view=month — the
// month grid is the only view that supports drag-to-day + checkbox completion.
export function TaskModeToggle() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = params.get("view") ?? "week";
  const on = params.get("tm") === "1";
  const monthOnly = view === "month";

  function toggle() {
    const next = new URLSearchParams(params.toString());
    if (on) next.delete("tm");
    else next.set("tm", "1");
    router.push(`${pathname}?${next.toString()}`);
  }

  if (!monthOnly) {
    return (
      <button
        disabled
        title="Task mode only works in month view"
        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-fg-muted)]/60 cursor-not-allowed"
      >
        <CheckSquare size={12} /> Task mode
        <span className="text-[9px] opacity-70">(month only)</span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className={cn(
        "w-full flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors",
        on
          ? "border-white/40 bg-white/15 text-[var(--color-fg)]"
          : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-fg)]/[0.04]",
      )}
    >
      <CheckSquare size={12} />
      Task mode {on ? "on" : "off"}
    </button>
  );
}
