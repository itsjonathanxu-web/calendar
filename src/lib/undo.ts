"use client";

// Minimal global undo/redo stack. Mutation sites (drag-move, drag-resize,
// toggle-complete, dialog edit, dialog delete) push an entry with closures
// for undoing and redoing the change. Cmd+Z pops + runs undo; Cmd+Shift+Z
// (or Cmd+Y) pops the redo stack and re-runs.
//
// Lives in module scope rather than React context so non-component code
// (event handlers in deeply nested grids) can call push() without prop drill.

export type UndoEntry = {
  label: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
};

const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const MAX = 50;
let toastFn: ((msg: string) => void) | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setToast(fn: (msg: string) => void) {
  toastFn = fn;
}

export function pushUndo(entry: UndoEntry) {
  undoStack.push(entry);
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0; // new action invalidates the redo path
  emit();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export async function undo(): Promise<void> {
  const e = undoStack.pop();
  if (!e) return;
  emit();
  try {
    await e.undo();
    redoStack.push(e);
    emit();
    toastFn?.(`Undid: ${e.label}`);
  } catch (err) {
    console.error("[undo] failed:", err);
    toastFn?.(`Undo failed: ${e.label}`);
    // Put it back so the user can try again
    undoStack.push(e);
    emit();
  }
}

export async function redo(): Promise<void> {
  const e = redoStack.pop();
  if (!e) return;
  emit();
  try {
    await e.redo();
    undoStack.push(e);
    emit();
    toastFn?.(`Redid: ${e.label}`);
  } catch (err) {
    console.error("[redo] failed:", err);
    toastFn?.(`Redo failed: ${e.label}`);
    redoStack.push(e);
    emit();
  }
}

// Shared HTTP helper for undo/redo callbacks
export async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json();
}
