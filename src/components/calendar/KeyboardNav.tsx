"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Bind ←/→ arrows to the calendar's prev/next links. Idle when the focus is
// in an input — so typing in a search field doesn't navigate.
export function KeyboardNav({ prevHref, nextHref }: { prevHref: string; nextHref: string }) {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        router.push(prevHref);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        router.push(nextHref);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prevHref, nextHref]);
  return null;
}
