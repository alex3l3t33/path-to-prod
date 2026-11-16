import { describe, expect, it } from "vitest";
import { expandEventDates, parseAllDayEvents } from "../src/calendar/ics";

describe("ICS calendar parsing", () => {
  it("parses folded calendars and expands exclusive end dates", () => {
    const value = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Winter leave",
      "DTSTART;VALUE=DATE:20261224",
      "DTEND;VALUE=DATE:20261228",
      "DESCRIPTION:This is a long",
      " folded line",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const events = parseAllDayEvents(value);
    expect(events).toEqual([
      {
        start: "2026-12-24",
        endExclusive: "2026-12-28",
        summary: "Winter leave"
      }
    ]);
    expect(expandEventDates(events[0]!)).toEqual([
      "2026-12-24",
      "2026-12-25",
      "2026-12-26",
      "2026-12-27"
    ]);
  });

  it("ignores timed meetings", () => {
    const value = [
      "BEGIN:VEVENT",
      "DTSTART:20261224T090000Z",
      "DTEND:20261224T100000Z",
      "END:VEVENT"
    ].join("\n");
    expect(parseAllDayEvents(value)).toEqual([]);
  });
});
