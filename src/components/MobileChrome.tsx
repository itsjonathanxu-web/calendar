"use client";

import { useEffect, useState } from "react";
import { Menu, ListFilter, X } from "lucide-react";

// Mobile-only chrome: a top bar with hamburger (nav drawer) and a filter
// button (calendar drawer), plus the dim backdrop that closes whichever
// drawer is open. Sits on top of the calendar grid on small screens; hidden
// on lg+ where both sidebars are inline.

export function MobileTopBar({ showFilter = true }: { showFilter?: boolean }) {
  const [open, setOpen] = useState<"nav" | "filters" | null>(null);

  useEffect(() => {
    const cl = document.body.classList;
    cl.toggle("nav-open", open === "nav");
    cl.toggle("filters-open", open === "filters");
    return () => {
      cl.remove("nav-open");
      cl.remove("filters-open");
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="fixed top-2 left-2 z-[70] flex items-center gap-1.5">
        <button
          onClick={() => setOpen(open === "nav" ? null : "nav")}
          aria-label={open === "nav" ? "Close menu" : "Open menu"}
          className="glass-strong w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
        >
          {open === "nav" ? <X size={16} /> : <Menu size={16} />}
        </button>
        {showFilter && (
          <button
            onClick={() => setOpen(open === "filters" ? null : "filters")}
            aria-label={open === "filters" ? "Close filters" : "Open filters"}
            className="glass-strong w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
          >
            {open === "filters" ? <X size={16} /> : <ListFilter size={16} />}
          </button>
        )}
      </div>
      <div className="mobile-backdrop" onClick={() => setOpen(null)} />
    </>
  );
}
