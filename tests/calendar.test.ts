import { describe, expect, it } from "vitest";
import { CapacityCalendar, parseDate, toDateKey } from "../src/forecast/calendar";

describe("CapacityCalendar", () => {
  it("skips weekends and holidays", () => {
    const calendar = new CapacityCalendar({
      teamSize: 2,
      focusFactor: 1,
      holidays: ["2026-11-17"],
      leave: []
    });
    const finish = calendar.finishWork(parseDate("2026-11-16"), 4, 1);
    expect(toDateKey(finish)).toBe("2026-11-20");
  });

  it("reduces capacity for unique people on leave", () => {
    const calendar = new CapacityCalendar({
      teamSize: 2,
      focusFactor: 1,
      holidays: [],
      leave: [
        { person: "Ada", start: "2026-11-16", end: "2026-11-16" },
        { person: "Ada", start: "2026-11-16", end: "2026-11-16" }
      ]
    });
    expect(calendar.capacityFor(parseDate("2026-11-16"), 2)).toBe(1);
  });
});

