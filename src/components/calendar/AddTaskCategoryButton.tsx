"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

const COLOR_PALETTE = [
  "#dc2626", "#f97316", "#eab308", "#22c55e",
  "#0ea5e9", "#8b5cf6", "#ec4899", "#7c7c7c",
];

export function AddTaskCategoryButton({
  defaultSection = "tasks",
}: {
  defaultSection?: "scheduling" | "tasks";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_PALETTE[4]);
  const [section, setSection] = useState<"scheduling" | "tasks">(defaultSection);
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
        body: JSON.stringify({ name: name.trim(), color, section }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "create failed");
      setName("");
      setColor(COLOR_PALETTE[4]);
      setSection(defaultSection);
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
        onClick={() => {
          setSection(defaultSection);
          setOpen(true);
        }}
        title="Add category"
        aria-label="Add category"
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
              <div className="text-sm font-semibold">New category</div>
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
              <div className="flex gap-1.5 rounded-lg bg-white/5 p-1">
                {(["scheduling", "tasks"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSection(s)}
                    className={
                      "flex-1 text-xs px-2 py-1.5 rounded-md capitalize transition-colors " +
                      (section === s
                        ? "bg-white text-black font-medium"
                        : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2 items-center">
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
                  <label
                    title="Custom color"
                    className={
                      "w-6 h-6 rounded-md border cursor-pointer relative overflow-hidden " +
                      (COLOR_PALETTE.includes(color)
                        ? "border-white/10 hover:border-white/40"
                        : "border-white/80 ring-2 ring-white/30")
                    }
                    style={
                      COLOR_PALETTE.includes(color)
                        ? {
                            background:
                              "conic-gradient(from 0deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
                          }
                        : { backgroundColor: color }
                    }
                  >
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      aria-label="Custom color picker"
                    />
                  </label>
                </div>
                <input
                  type="text"
                  value={color}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(v) || v === "") setColor(v || color);
                  }}
                  placeholder="#7c7c7c"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2 py-1 text-xs font-mono"
                />
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
