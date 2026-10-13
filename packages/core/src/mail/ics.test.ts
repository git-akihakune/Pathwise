import { describe, expect, it } from "vitest";
import { bareEmail, buildCheckinIcs, escapeIcsText } from "./ics";

const base = {
  uid: "checkin-u1@coach.example.com",
  method: "REQUEST" as const,
  sequence: 2,
  timezone: "Europe/Berlin",
  day: 0,
  time: "18:00",
  firstDate: "2026-10-18",
  organizer: "coach@example.com",
  attendee: { email: "ada@example.com", name: "Ada" },
  url: "https://coach.example.com/checkin",
  now: new Date("2026-10-12T09:30:00Z"),
};

describe("buildCheckinIcs", () => {
  it("builds a weekly REQUEST in the user's zone with CRLF line breaks", () => {
    const ics = buildCheckinIcs(base);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    expect(ics.split("\r\n")).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Pathwise//Check-ins//EN",
        "METHOD:REQUEST",
        "UID:checkin-u1@coach.example.com",
        "SEQUENCE:2",
        "DTSTAMP:20261012T093000Z",
        "DTSTART;TZID=Europe/Berlin:20261018T180000",
        "DURATION:PT15M",
        "RRULE:FREQ=WEEKLY;BYDAY=SU",
        "SUMMARY:Pathwise weekly check-in",
        "STATUS:CONFIRMED",
        "ORGANIZER;CN=Pathwise:mailto:coach@example.com",
        "END:VCALENDAR",
      ]),
    );
  });
  it.each([
    [0, "SU"],
    [1, "MO"],
    [3, "WE"],
    [6, "SA"],
  ])("day %i → BYDAY=%s", (day, by) => {
    expect(buildCheckinIcs({ ...base, day })).toContain(`RRULE:FREQ=WEEKLY;BYDAY=${by}\r\n`);
  });
  it("cancels with the same UID", () => {
    const ics = buildCheckinIcs({ ...base, method: "CANCEL", sequence: 3 });
    expect(ics).toContain("METHOD:CANCEL\r\n");
    expect(ics).toContain("STATUS:CANCELLED\r\n");
    expect(ics).toContain("UID:checkin-u1@coach.example.com\r\n");
  });
  it("folds long lines at 75 octets without splitting characters", () => {
    const name = "Zoë ".repeat(40).trim();
    const ics = buildCheckinIcs({ ...base, attendee: { email: "ada@example.com", name } });
    for (const line of ics.split("\r\n"))
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(ics).not.toContain("�");
    expect(ics.replaceAll("\r\n ", "")).toContain(
      `ATTENDEE;CN="${name}";RSVP=FALSE:mailto:ada@example.com`,
    );
  });
  it("strips quotes and control characters from the attendee name", () => {
    const ics = buildCheckinIcs({
      ...base,
      attendee: { email: "ada@example.com", name: 'A"da\r\nX-EVIL:1' },
    });
    expect(ics).not.toContain("\r\nX-EVIL");
    expect(ics).toContain('ATTENDEE;CN="AdaX-EVIL:1";RSVP=FALSE');
  });
});

it("escapes TEXT values", () => {
  expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b;c\\\\d\\ne");
});

it("parses the bare address out of a From header", () => {
  expect(bareEmail("Pathwise Coach <coach@example.com>")).toBe("coach@example.com");
  expect(bareEmail('"Coach, The" <coach@example.com>')).toBe("coach@example.com");
  expect(bareEmail("coach@example.com")).toBe("coach@example.com");
});

it("uses the bare address as organizer when From has a display name", () => {
  const ics = buildCheckinIcs({ ...base, organizer: bareEmail("Pathwise <coach@example.com>") });
  expect(ics).toContain("ORGANIZER;CN=Pathwise:mailto:coach@example.com\r\n");
});
