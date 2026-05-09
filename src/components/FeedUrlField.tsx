"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function FeedUrlField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard might be blocked — user can long-press the field */
    }
  }

  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-mono"
      />
      <button
        type="button"
        onClick={copy}
        className="text-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-fg)]/[0.04] inline-flex items-center gap-1.5"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
