"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { ChatPanel } from "./ChatPanel";

export function ChatToggle() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-fg)]/[0.04]"
      >
        <Sparkles size={12} className="text-[var(--color-accent)]" />
        <span>Schedule</span>
      </button>
      <ChatPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
