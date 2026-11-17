import { describe, expect, it } from "vitest";
import { buildEmailReport } from "../src/export/emailReport";
import type { EpicForecast, ForecastResult, TicketFeatures } from "../src/types";

const milestone = (p80: string, p95: string) => ({ p50: p80, p80, p95 });

describe("email report", () => {
  it("includes week numbers, stage dates, and escaped Jira text", () => {
    const epic: TicketFeatures = {
      id: "1",
      key: "DEMO-7",
      summary: "Launch <script>alert(1)</script> & measure",
      issueType: "Epic",
      labels: [],
      components: [],
      status: "In Progress",
      createdAt: "2026-11-17T00:00:00.000Z",
      sprintNames: []
    };
    const forecast = {
      generatedAt: "2026-11-17T00:00:00.000Z",
      issueCount: 2,
      historicalIssueCount: 20,
      methodology: "scrum",
      methodologyReason: "Configured manually.",
      sprintLengthWeeks: 2,
      dataConfidence: "medium",
      sampleCounts: { development: 20, staging: 20, production: 20 },
      currentStageCounts: { development: 1, staging: 0, production: 0, unmapped: 1 },
      holidayCount: 0,
      leavePeriodCount: 0,
      developerWorkloads: [],
      milestones: {
        development: milestone("2026-12-18", "2026-12-24"),
        staging: milestone("2026-12-30", "2027-01-02"),
        production: milestone("2027-01-04", "2027-01-08")
      },
      warnings: []
    } satisfies ForecastResult;
    const entry: EpicForecast = {
      epic, totalChildren: 2, completedChildren: 0, remainingChildren: 2,
      reserveTickets: 1, forecast
    };
    const report = buildEmailReport({
      project: "DEMO",
      generatedAt: "2026-11-17T12:00:00.000Z",
      mode: "epics",
      epics: [entry],
      alerts: []
    });

    expect(report.subject).toContain("Epic timeline");
    expect(report.text).toContain("2027-01-04 · W01 2027");
    expect(report.text).toContain("2026-12-30 · W53 2026");
    expect(report.html).toContain("Launch &lt;script&gt;alert(1)&lt;/script&gt; &amp; measure");
    expect(report.html).not.toContain("<script>");
    expect(report.html).toContain("#fff1e3");
  });
});
