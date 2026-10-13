const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export interface CheckinIcsInput {
  uid: string;
  method: "REQUEST" | "CANCEL";
  sequence: number;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** HH:MM local time. */
  time: string;
  /** Local date of the first occurrence, YYYY-MM-DD. */
  firstDate: string;
  /** Bare email address (see bareEmail). */
  organizer: string;
  attendee: { email: string; name: string };
  url: string;
  now: Date;
}

/** RFC 5545 TEXT escaping: backslash first, then `;`, `,` and newlines. */
export function escapeIcsText(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll(";", ";")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n|\r|\n/g, "\\n");
}

/** The bare address of a From value such as `Name <addr@host>` (or just `addr@host`). */
export function bareEmail(from: string): string {
  const m = /<([^<>]+)>\s*$/.exec(from);
  return (m?.[1] ?? from).trim();
}

/** Folds a content line to at most 75 octets per physical line, never splitting a code point. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

const utcStamp = (d: Date) => `${d.toISOString().replaceAll(/[-:]/g, "").slice(0, 15)}Z`;

/** A weekly recurring check-in event. VTIMEZONE is omitted: clients resolve IANA TZIDs. */
export function buildCheckinIcs(i: CheckinIcsInput): string {
  // CR, LF and DQUOTE can't appear in a quoted parameter value; drop other control characters too.
  const cn = [...i.attendee.name]
    .filter((c) => c !== '"' && c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f)
    .join("");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pathwise//Check-ins//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${i.method}`,
    "BEGIN:VEVENT",
    `UID:${i.uid}`,
    `SEQUENCE:${i.sequence}`,
    `DTSTAMP:${utcStamp(i.now)}`,
    `DTSTART;TZID=${i.timezone}:${i.firstDate.replaceAll("-", "")}T${i.time.replace(":", "")}00`,
    "DURATION:PT15M",
    `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[i.day]}`,
    "SUMMARY:Pathwise weekly check-in",
    `DESCRIPTION:${escapeIcsText(`Start your check-in: ${i.url}`)}`,
    `URL:${i.url}`,
    `ORGANIZER;CN=Pathwise:mailto:${i.organizer}`,
    `ATTENDEE;CN="${cn}";RSVP=FALSE:mailto:${i.attendee.email}`,
    `STATUS:${i.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
