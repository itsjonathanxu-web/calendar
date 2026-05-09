"use client";

import { useEffect, useState } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";

const WEEK_OPTS = { weekStartsOn: 0 as const };

// Server is UTC; rendering "today" there at 9pm EDT shows tomorrow's date.
// Defer to a client effect so the heading reflects the user's actual clock.
export function TodayDateLabel() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  if (!now) {
    return <span className="opacity-0">placeholder</span>;
  }
  const s = startOfWeek(now, WEEK_OPTS);
  const e = endOfWeek(now, WEEK_OPTS);
  return (
    <>
      {format(now, "EEEE, MMM d")} · week of {format(s, "MMM d")}–{format(e, "MMM d")}
    </>
  );
}
