"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, GripVertical } from "lucide-react";
import { AddTaskCategoryButton } from "./AddTaskCategoryButton";
import { TaskModeToggle } from "./TaskModeToggle";
import { useDeviceFilter } from "@/lib/use-device-filter";
import { useReorderDrag } from "@/lib/use-reorder-drag";

const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  "notion-mcp": "Local",
};

const COLOR_PALETTE = [
  "#dc2626", "#f97316", "#eab308", "#22c55e",
  "#0ea5e9", "#8b5cf6", "#ec4899", "#7c7c7c",
];

type CalRow = {
  id: string;
  name: string;
  color: string;
  section: string;
  source: string;
  accountLabel: string;
  sortKey: number;
};

export function FilterControls({
  calendars,
  initialDisabled,
}: {
  calendars: CalRow[];
  initialDisabled: string[];
}) {
  const router = useRouter();
  const { isEnabled, toggle } = useDeviceFilter(initialDisabled);
  const [editing, setEditing] = useState<CalRow | null>(null);

  // Drag-to-reorder: emit a definitive [idx*10] sortOrder for every row in the
  // group after a drop so spacings stay clean even after many reorders.
  async function reorderGroup(group: CalRow[], from: number, to: number) {
    const next = group.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await Promise.all(
      next.map((c, i) =>
        fetch("/api/calendars/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: c.id, sortOrder: i * 10 }),
        }),
      ),
    );
    router.refresh();
  }

  const scheduling = calendars
    .filter((c) => c.section === "scheduling")
    .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name));
  const tasks = calendars
    .filter((c) => c.section === "tasks")
    .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name));

  // Google calendars stay grouped per account (the "Holidays in Canada" /
  // gmail-account split matters). Everything else collapses into one
  // unlabeled bucket directly under "Scheduling".
  const localScheduling = scheduling.filter((c) => c.source !== "google");
  const googleScheduling = scheduling.filter((c) => c.source === "google");
  const googleGroups = new Map<string, CalRow[]>();
  for (const c of googleScheduling) {
    const key = c.accountLabel;
    if (!googleGroups.has(key)) googleGroups.set(key, []);
    googleGroups.get(key)!.push(c);
  }

  return (
    <div className="p-2 space-y-5">
      <div className="px-1">
        <TaskModeToggle />
      </div>

      <Section title="Scheduling" right={<AddTaskCategoryButton defaultSection="scheduling" />}>
        <ReorderableList
          group={localScheduling}
          isEnabled={isEnabled}
          onToggle={toggle}
          onEdit={(c) => setEditing(c)}
          onDrop={(from, to) => reorderGroup(localScheduling, from, to)}
        />
        {Array.from(googleGroups.entries()).map(([label, cals]) => (
          <div key={label} className="space-y-0.5">
            <div className="px-2 pb-0.5 pt-3 text-[9px] uppercase tracking-wider text-[var(--color-fg-muted)]/70">
              {SOURCE_LABELS.google} · {label}
            </div>
            <ReorderableList
              group={cals}
              isEnabled={isEnabled}
              onToggle={toggle}
              onEdit={(c) => setEditing(c)}
              onDrop={(from, to) => reorderGroup(cals, from, to)}
            />
          </div>
        ))}
        {scheduling.length === 0 && (
          <div className="px-2 py-1 text-xs text-[var(--color-fg-muted)]">
            No synced calendars yet.
          </div>
        )}
      </Section>

      <Section title="Tasks" right={<AddTaskCategoryButton defaultSection="tasks" />}>
        {tasks.length === 0 && (
          <div className="px-2 py-1 text-xs text-[var(--color-fg-muted)]">
            No task categories yet.
          </div>
        )}
        <ReorderableList
          group={tasks}
          isEnabled={isEnabled}
          onToggle={toggle}
          onEdit={(c) => setEditing(c)}
          onDrop={(from, to) => reorderGroup(tasks, from, to)}
        />
      </Section>

      {editing && (
        <EditCategoryDialog
          c={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-2 pb-1.5 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
          {title}
        </div>
        {right}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ReorderableList({
  group,
  isEnabled,
  onToggle,
  onEdit,
  onDrop,
}: {
  group: CalRow[];
  isEnabled: (id: string) => boolean;
  onToggle: (id: string) => void;
  onEdit: (c: CalRow) => void;
  onDrop: (from: number, to: number) => void | Promise<void>;
}) {
  const { onPointerDown, draggingIdx, overIdx } = useReorderDrag({ onDrop });
  return (
    <div className="space-y-0.5">
      {group.map((c, i) => (
        <CalendarRow
          key={c.id}
          c={c}
          index={i}
          enabled={isEnabled(c.id)}
          onToggle={() => onToggle(c.id)}
          onEdit={() => onEdit(c)}
          onPointerDown={(e) => onPointerDown(e, i)}
          dragging={draggingIdx === i}
          dragOver={overIdx === i && draggingIdx !== null && draggingIdx !== i}
        />
      ))}
    </div>
  );
}

function CalendarRow({
  c,
  index,
  enabled,
  onToggle,
  onEdit,
  onPointerDown,
  dragging,
  dragOver,
}: {
  c: CalRow;
  index: number;
  enabled: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  dragging: boolean;
  dragOver: boolean;
}) {
  return (
    <div
      data-row-idx={index}
      onPointerDown={onPointerDown}
      className={
        "group/row flex items-center gap-1 pr-1 rounded hover:bg-[var(--color-fg)]/[0.04] touch-none select-none transition-colors " +
        (dragging ? "opacity-50 ring-1 ring-white/40" : "") +
        (dragOver ? " bg-white/[0.08]" : "")
      }
    >
      <span
        aria-hidden
        className="w-3 h-5 flex items-center justify-center text-[var(--color-fg-muted)]/60 cursor-grab active:cursor-grabbing pl-1"
      >
        <GripVertical size={10} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 flex-1 min-w-0 py-1 text-left"
      >
        <span
          className={
            "w-3 h-3 rounded-[3px] shrink-0 border " +
            (enabled ? "border-transparent" : "border-[var(--color-border)] bg-transparent")
          }
          style={enabled ? { backgroundColor: c.color } : { borderColor: c.color }}
        />
        <span
          className={
            "text-sm truncate flex-1 min-w-0 " +
            (enabled ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)] line-through")
          }
        >
          {c.name}
        </span>
      </button>
      <div className="opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit category"
          title="Edit"
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-white/[0.06]"
        >
          <Pencil size={11} />
        </button>
      </div>
    </div>
  );
}

function EditCategoryDialog({
  c,
  onClose,
}: {
  c: CalRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);
  const [section, setSection] = useState<"scheduling" | "tasks">(
    c.section === "scheduling" ? "scheduling" : "tasks",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only locally-created categories (notion-mcp source) can be safely
  // edited or deleted. Synced calendars (google, apple) get their name/color
  // from the source and would re-appear on next sync.
  const editableSource = c.source === "notion-mcp";

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendars/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: c.id,
          name: name.trim(),
          color,
          section,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "update failed");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete "${c.name}" and all its events? This can't be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendars/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "delete failed");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong w-full max-w-xs rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
          <div className="text-sm font-semibold">Edit category</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-fg)]/[0.06]">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Category name"
            disabled={!editableSource}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-3 py-2 text-sm disabled:opacity-50"
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
              {COLOR_PALETTE.map((cc) => (
                <button
                  key={cc}
                  onClick={() => setColor(cc)}
                  aria-label={`Pick color ${cc}`}
                  className={
                    "w-6 h-6 rounded-md border " +
                    (color === cc
                      ? "border-white/80 ring-2 ring-white/30"
                      : "border-white/10 hover:border-white/40")
                  }
                  style={{ backgroundColor: cc }}
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
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm border border-white/10"
                style={{ backgroundColor: color }}
              />
              <input
                type="text"
                value={color}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (/^#[0-9a-fA-F]{6}$/.test(v) || v === "") setColor(v || color);
                }}
                placeholder="#7c7c7c"
                className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2 py-1 text-xs font-mono"
              />
            </div>
          </div>
          {!editableSource && (
            <p className="text-[10px] text-[var(--color-fg-muted)]">
              Synced from {c.accountLabel}. Color and section can be customized;
              renaming should be done in the source.
            </p>
          )}
          {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        </div>
        <div className="flex justify-between items-center gap-2 px-4 py-2.5 border-t border-[var(--color-border)]">
          {editableSource ? (
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs text-[var(--color-danger)] hover:underline disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !name.trim()}
              className="text-xs rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-1.5 font-medium disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
