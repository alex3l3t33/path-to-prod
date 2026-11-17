import { describe, expect, it } from "vitest";
import { isoWeek, mondayOfIsoWeek, weekLabel } from "../src/forecast/weeks";

describe("ISO week labels", () => {
  it("uses Monday starts and the ISO week year across New Year", () => {
    expect(mondayOfIsoWeek("2027-01-01")).toBe("2026-12-28");
    expect(isoWeek("2027-01-01")).toEqual({ week: 53, year: 2026 });
    expect(weekLabel("2027-01-04")).toBe("W01 2027");
  });

  it("labels the current forecast week", () => {
    expect(weekLabel("2026-11-17")).toBe("W47 2026");
  });
});
