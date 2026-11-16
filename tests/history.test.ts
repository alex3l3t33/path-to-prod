import { describe, expect, it } from "vitest";
import { buildHistoricalIssue, businessDaysBetween } from "../src/forecast/history";
import { TEST_SETTINGS } from "./fixtures";

describe("history extraction", () => {
  it("counts elapsed weekdays", () => {
    expect(
      businessDaysBetween("2026-11-13T00:00:00.000Z", "2026-11-16T00:00:00.000Z")
    ).toBe(1);
  });

  it("maps Jira transition intervals to delivery stages", () => {
    const historical = buildHistoricalIssue(
      {
        id: "1",
        key: "DEMO-1",
        summary: "Ship a useful thing",
        issueType: "Story",
        labels: [],
        components: [],
        status: "Done",
        createdAt: "2026-11-09T00:00:00.000Z",
        resolvedAt: "2026-11-13T00:00:00.000Z",
        sprintNames: ["Sprint 42"]
      },
      [
        {
          createdAt: "2026-11-11T00:00:00.000Z",
          fromStatus: "In Progress",
          toStatus: "QA"
        },
        {
          createdAt: "2026-11-13T00:00:00.000Z",
          fromStatus: "QA",
          toStatus: "Done"
        }
      ],
      TEST_SETTINGS
    );
    expect(historical?.stageDurations.development).toBe(2);
    expect(historical?.stageDurations.staging).toBe(2);
  });
});

