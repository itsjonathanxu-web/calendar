// Tiny RFC 5545 emitter — just enough for a read-only subscription feed.

function fold(line: string): string {
  // RFC 5545 §3.1: lines must be ≤75 octets; longer lines split with CRLF + space.
  // Octet count, not characters — but for ASCII (our case) they coincide.
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  out.push(line.slice(0, 75));
  i += 75;
  while (i < line.length) {
    out.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return out.join("\r\n");
}

function escapeText(s: string): string {
  // RFC 5545 §3.3.11: backslash, semicolon, comma, newline must be escaped.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function fmtUtc(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

function fmtDate(d: Date): string {
  // YYYYMMDD — for VALUE=DATE all-day events. Use UTC fields; the all-day events
  // we store are normalized to UTC midnight.
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate())
  );
}

export type IcsEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  notes?: string | null;
};

export function buildIcs(opts: {
  prodId: string;
  calName: string;
  events: IcsEvent[];
}): string {
  const now = new Date();
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(`PRODID:${opts.prodId}`);
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(fold("X-WR-CALNAME:" + escapeText(opts.calName)));
  lines.push("X-WR-TIMEZONE:UTC");

  for (const ev of opts.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(fold("UID:" + ev.uid));
    lines.push("DTSTAMP:" + fmtUtc(now));
    if (ev.allDay) {
      // All-day events use VALUE=DATE on both DTSTART and DTEND.
      // DTEND is exclusive — so a single-day event on May 8 is DTSTART:20260508 / DTEND:20260509.
      const endExclusive = new Date(ev.end.getTime() + 1);
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(ev.start)}`);
      lines.push(`DTEND;VALUE=DATE:${fmtDate(endExclusive)}`);
    } else {
      lines.push(`DTSTART:${fmtUtc(ev.start)}`);
      lines.push(`DTEND:${fmtUtc(ev.end)}`);
    }
    lines.push(fold("SUMMARY:" + escapeText(ev.title || "(untitled)")));
    if (ev.notes && ev.notes.trim()) {
      lines.push(fold("DESCRIPTION:" + escapeText(ev.notes)));
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 mandates CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}
