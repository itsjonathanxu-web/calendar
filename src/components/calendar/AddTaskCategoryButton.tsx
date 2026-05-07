"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

const COLOR_PALETTE = [
  "#dc2626", "#f97316", "#eab308", "#22c55e",
  "#0ea5e9", "#8b5cf6", "#ec4899", "#7c7c7c",
];

export function AddTaskCategoryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_PALETTE[4]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendars/create-task-subcategory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "create failed");
      setName("");
      setColor(COLOR_PALETTE[4]);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add task category"
        aria-label="Add task category"
        className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-fg)]/[0.06]"
      >
        <Plus size={12} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-strong w-full max-w-xs rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
              <div className="text-sm font-semibold">New task category</div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-[var(--color-fg)]/[0.06]"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Category name"
                autoFocus
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    aria-label={`Pick color ${c}`}
                    className={
                      "w-6 h-6 rounded-md border " +
                      (color === c
                        ? "border-white/80 ring-2 ring-white/30"
                        : "border-white/10 hover:border-white/40")
                    }
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-[var(--color-border)]">
              <button
                onClick={() => setOpen(false)}
                className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !name.trim()}
                className="text-xs rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-1.5 font-medium disabled:opacity-50"
              >
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
