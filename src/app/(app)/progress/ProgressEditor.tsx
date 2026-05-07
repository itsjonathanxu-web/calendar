"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";

const COLOR_PALETTE = [
  "#dc2626", "#f97316", "#eab308", "#22c55e",
  "#0ea5e9", "#8b5cf6", "#ec4899", "#7c7c7c",
];

type Goal = {
  id: string;
  name: string;
  color: string;
  mode: string;
  target: number;
  matchCalendars: string | null;
  matchTitles: string | null;
};

type Calendar = { id: string; name: string; color: string };

export function ProgressEditor({
  goals,
  calendars,
}: {
  goals: Goal[];
  calendars: Calendar[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_PALETTE[4]);
  const [mode, setMode] = useState<"count" | "hours" | "daily">("count");
  const [target, setTarget] = useState(3);
  const [titles, setTitles] = useState("");
  const [matchCals, setMatchCals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/progress/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          color,
          mode,
          target,
          matchCalendars: matchCals,
          matchTitles: titles.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "create failed");
      setName("");
      setTitles("");
      setMatchCals([]);
      setTarget(3);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this goal?")) return;
    await fetch("/api/progress/goals", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  function toggleCal(id: string) {
    setMatchCals((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Manage goals
        </h2>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04]"
        >
          <Plus size={12} /> New goal
        </button>
      </div>

      {open && (
        <div className="glass rounded-xl p-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Goal name (e.g. Fitness)"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-[var(--color-fg-muted)]">
              Mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2 py-1.5 text-sm"
              >
                <option value="count">Count per week</option>
                <option value="hours">Hours per week</option>
                <option value="daily">Days per week</option>
              </select>
            </label>
            <label className="block text-xs text-[var(--color-fg-muted)]">
              Target {mode === "hours" ? "hours" : mode === "daily" ? "days (max 7)" : "events"}
              <input
                type="number"
                min={1}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value) || 1)}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[var(--color-fg-muted)]">Color</div>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
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
          </div>

          <label className="block text-xs text-[var(--color-fg-muted)]">
            Title keywords (comma-separated, optional)
            <input
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
              placeholder="workout, swim, run"
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2 py-1.5 text-sm"
            />
          </label>

          <div className="space-y-1">
            <div className="text-xs text-[var(--color-fg-muted)]">
              Or match these calendars (optional, click to toggle)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {calendars.map((c) => {
                const on = matchCals.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCal(c.id)}
                    className={
                      "text-[11px] rounded-md px-2 py-0.5 border " +
                      (on
                        ? "border-white/40 bg-white/10"
                        : "border-white/10 hover:border-white/30 bg-white/5")
                    }
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setOpen(false)}
              className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={add}
              disabled={busy || !name.trim()}
              className="text-xs rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-1.5 font-medium disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add goal"}
            </button>
          </div>
        </div>
      )}

      {goals.length > 0 && (
        <div className="space-y-1">
          {goals.map((g) => (
            <div
              key={g.id}
              className="glass-subtle rounded-md px-3 py-1.5 flex items-center gap-2 text-xs"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: g.color }}
              />
              <div className="flex-1 truncate">
                {g.name}
                <span className="text-[var(--color-fg-muted)] ml-2">
                  · {g.mode === "hours" ? `${g.target}h/wk` : g.mode === "daily" ? `${g.target}d/wk` : `${g.target}/wk`}
                </span>
              </div>
              <button
                onClick={() => remove(g.id)}
                className="text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] p-1"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
