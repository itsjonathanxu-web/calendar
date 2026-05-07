"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { EventDialog, type DialogMode, type WritableCalendar } from "./EventDialog";

export function NewEventButton({ calendars }: { calendars: WritableCalendar[] }) {
  const [mode, setMode] = useState<DialogMode>(null);

  function open() {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    setMode({ kind: "create", start, end });
  }

  return (
    <>
      <button
        onClick={open}
        className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-2 py-1 hover:opacity-90"
        title="New event"
      >
        <Plus size={12} /> Event
      </button>
      <EventDialog mode={mode} onClose={() => setMode(null)} calendars={calendars} />
    </>
  );
}
