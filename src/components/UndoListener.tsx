"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Redo2 } from "lucide-react";
import { canUndo, canRedo, undo, redo, subscribe, setToast } from "@/lib/undo";

export function UndoListener() {
  const router = useRouter();
  const [, force] = useState(0);
  const [toast, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    setToast((msg) => {
      setToastMsg(msg);
      window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 1800);
    });
    return subscribe(() => force((x) => x + 1));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Skip when user is typing in an input/textarea
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo().then(() => router.refresh());
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo().then(() => router.refresh());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const undoable = canUndo();
  const redoable = canRedo();

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 pointer-events-none">
        <button
          onClick={() => undo().then(() => router.refresh())}
          disabled={!undoable}
          aria-label="Undo (⌘Z)"
          title="Undo (⌘Z)"
          className="pointer-events-auto glass-strong rounded-full w-9 h-9 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-30 disabled:cursor-not-allowed shadow-lg"
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={() => redo().then(() => router.refresh())}
          disabled={!redoable}
          aria-label="Redo (⌘⇧Z)"
          title="Redo (⌘⇧Z)"
          className="pointer-events-auto glass-strong rounded-full w-9 h-9 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-30 disabled:cursor-not-allowed shadow-lg"
        >
          <Redo2 size={14} />
        </button>
      </div>
      {toast && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 glass-strong rounded-full px-3 py-1.5 text-xs shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </>
  );
}
