import { describe, expect, it } from "vitest";
import { forecastGoal } from "../src/forecast/engine";
import type { HistoricalIssue, TicketFeatures } from "../src/types";
import { TEST_SETTINGS } from "./fixtures";

const goal: TicketFeatures[] = [
  {
    id: "goal-1",
    key: "DEMO-99",
    summary: "Add customer export",
    issueType: "Story",
    priority: "Medium",
    labels: ["export"],
    components: ["Web"],
    status: "In Progress",
    createdAt: "2026-11-16T00:00:00.000Z",
    sprintNames: ["Sprint 43"],
    assignee: { id: "ada", displayName: "Ada Lovelace" }
  }
];

const history: HistoricalIssue[] = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  key: `DEMO-${index}`,
  summary: `Customer export improvement ${index}`,
  issueType: "Story",
  priority: "Medium",
  labels: ["export"],
  components: ["Web"],
  status: "Done",
  createdAt: "2026-10-01T00:00:00.000Z",
  resolvedAt: "2026-10-10T00:00:00.000Z",
  sprintNames: ["Sprint 42"],
  stageDurations: {
    development: 2 + (index % 3),
    staging: 1 + (index % 2),
    production: 0.5
  }
}));

describe("forecastGoal", () => {
  it("returns ordered, deterministic milestone percentiles", () => {
    const settings = {
      ...TEST_SETTINGS,
      simulations: 500,
      teamSize: 1,
      focusFactor: 1,
      stageCapacity: { development: 1, staging: 1, production: 1 },
      holidays: ["2026-11-18"],
      releaseWeekdays: [2, 4]
    };
    const first = forecastGoal(goal, history, settings, {
      startDate: "2026-11-16",
      seed: 123
    });
    const second = forecastGoal(goal, history, settings, {
      startDate: "2026-11-16",
      seed: 123
    });

    expect(first.milestones).toEqual(second.milestones);
    expect(first.milestones.development.p50 <= first.milestones.development.p80).toBe(
      true
    );
    expect(first.milestones.development.p80 <= first.milestones.development.p95).toBe(
      true
    );
    expect([2, 4]).toContain(
      new Date(`${first.milestones.production.p80}T00:00:00.000Z`).getUTCDay()
    );
    expect(first.developerWorkloads).toEqual([
      {
        id: "ada",
        displayName: "Ada Lovelace",
        unassigned: false,
        tickets: [
          {
            key: "DEMO-99",
            summary: "Add customer export",
            issueType: "Story",
            priority: "Medium",
            status: "In Progress"
          }
        ]
      }
    ]);
  });

  it("auto-detects Scrum and moves development to a sprint boundary", () => {
    const scrum = forecastGoal(
      goal,
      history,
      {
        ...TEST_SETTINGS,
        simulations: 200,
        teamSize: 1,
        focusFactor: 1,
        stageCapacity: { development: 1, staging: 1, production: 1 },
        releaseWeekdays: []
      },
      { startDate: "2026-11-16", seed: 10 }
    );
    const kanban = forecastGoal(
      goal,
      history,
      {
        ...TEST_SETTINGS,
        agilityMethod: "kanban",
        simulations: 200,
        teamSize: 1,
        focusFactor: 1,
        stageCapacity: { development: 1, staging: 1, production: 1 },
        releaseWeekdays: []
      },
      { startDate: "2026-11-16", seed: 10 }
    );

    expect(scrum.methodology).toBe("scrum");
    expect(kanban.methodology).toBe("kanban");
    expect(scrum.milestones.development.p50 > kanban.milestones.development.p50).toBe(
      true
    );
    expect(scrum.milestones.development.p50).toBe("2026-11-27");
  });

  it("adds historical throughput context without creating a performance score", () => {
    const assignedHistory = history.map((issue, index) => ({
      ...issue,
      assignee: { id: "ada", displayName: "Ada Lovelace" },
      resolvedAt: `2026-${String(1 + index).padStart(2, "0")}-15T00:00:00.000Z`
    }));
    const result = forecastGoal(
      goal,
      assignedHistory,
      { ...TEST_SETTINGS, simulations: 100 },
      { startDate: "2026-11-16", seed: 4 }
    );
    const context = result.developerWorkloads[0]?.throughput;

    expect(context?.completedCount).toBe(12);
    expect(context?.sufficientHistory).toBe(true);
    expect(context?.classification).toBe("team-range");
    expect(context?.completedPerMonth).toBeGreaterThan(0);
    expect(context?.medianDevelopmentDays).toBe(3);
  });
});

