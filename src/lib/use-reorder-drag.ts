"use client";

import { useRef, useState } from "react";

// Pointer-based drag-to-reorder. Wire `onPointerDown` onto each row, give
// each row `data-row-idx={i}`, and the hook tracks: which row is being
// dragged (`draggingIdx`), which row the cursor is currently over
// (`overIdx`), and fires `onDrop(from, to)` on pointerup if the cursor
// moved past a small threshold AND landed on a different row.
//
// Intended for short lists (sidebar groups, today's notes) — nothing
// virtualized. The `dropTargetSelector` is the data attribute used to find
// candidate target rows; default `[data-row-idx]`.
export function useReorderDrag(opts: {
  onDrop: (from: number, to: number) => void | Promise<void>;
  dropTargetSelector?: string;
}) {
  const sel = opts.dropTargetSelector ?? "[data-row-idx]";
  const draggingRef = useRef<{ idx: number; moved: boolean } | null>(null);
  const overRef = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, _setOverIdx] = useState<number | null>(null);
  const setOverIdx = (i: number | null) => {
    overRef.current = i;
    _setOverIdx(i);
  };

  function onPointerDown(e: React.PointerEvent, idx: number) {
    if (e.button !== 0) return;
    // Skip if user grabbed an interactive child (button, input, etc).
    const t = e.target as HTMLElement;
    if (t.closest("button, input, textarea, a, [role=button], [role=checkbox]")) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    draggingRef.current = { idx, moved: false };
    const startX = e.clientX;
    const startY = e.clientY;

    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!draggingRef.current.moved && Math.hypot(dx, dy) >= 6) {
        draggingRef.current.moved = true;
        setDraggingIdx(draggingRef.current.idx);
      }
      if (draggingRef.current.moved) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const row = el?.closest(sel) as HTMLElement | null;
        const attr = row?.getAttribute("data-row-idx");
        const i = attr != null ? Number(attr) : null;
        if (i !== overRef.current) setOverIdx(i);
      }
    }

    async function onUp(ev: PointerEvent) {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      const wasMove = draggingRef.current?.moved ?? false;
      const from = draggingRef.current?.idx ?? null;
      const to = overRef.current;
      draggingRef.current = null;
      setDraggingIdx(null);
      setOverIdx(null);
      if (!wasMove) return;
      if (from == null || to == null) return;
      if (from === to) return;
      await opts.onDrop(from, to);
    }

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  return { onPointerDown, draggingIdx, overIdx };
}
