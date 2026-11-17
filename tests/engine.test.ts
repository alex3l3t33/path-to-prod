import { describe, expect, it } from "vitest";
import { forecastGoal } from "../src/forecast/engine";
import { forecastEpics } from "../src/forecast/epics";
import { importantWorkAlerts } from "../src/forecast/alerts";
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

describe("epic forecasting", () => {
  const epic: TicketFeatures = {
    id: "epic-1",
    key: "DEMO-100",
    summary: "Customer self-service rollout",
    issueType: "Epic",
    labels: ["customer"],
    components: ["Web"],
    status: "In Progress",
    createdAt: "2026-11-01T00:00:00.000Z",
    sprintNames: []
  };
  const openChild: TicketFeatures = {
    ...goal[0]!,
    key: "DEMO-101",
    parentKey: epic.key,
    statusCategory: "indeterminate"
  };
  const doneChild: TicketFeatures = {
    ...goal[0]!,
    key: "DEMO-102",
    parentKey: epic.key,
    status: "Done",
    statusCategory: "done"
  };

  it("excludes completed children and lets an explicit reserve move the forecast", () => {
    const groups = [{ epic, children: [openChild, doneChild] }];
    const withoutReserve = forecastEpics(
      groups, history,
      { ...TEST_SETTINGS, unrefinedTicketsPerEpic: 0, agilityMethod: "kanban" },
      { startDate: "2026-11-16", seed: 7 }
    )[0]!;
    const withReserve = forecastEpics(
      groups, history,
      { ...TEST_SETTINGS, epicReserveOverrides: { [epic.key]: 2 }, agilityMethod: "kanban" },
      { startDate: "2026-11-16", seed: 7 }
    )[0]!;

    expect(withoutReserve.completedChildren).toBe(1);
    expect(withoutReserve.remainingChildren).toBe(1);
    expect(withoutReserve.forecast?.issueCount).toBe(1);
    expect(withReserve.forecast?.issueCount).toBe(3);
    expect(
      withReserve.forecast!.milestones.production.p80 >
      withoutReserve.forecast!.milestones.production.p80
    ).toBe(true);
    expect(withReserve.forecast?.warnings[0]).toContain("2 provisional tickets");
  });

  it("makes an empty epic forecastable with a reserve and honest with none", () => {
    const groups = [{ epic, children: [] }];
    const reserved = forecastEpics(groups, history, TEST_SETTINGS, {
      startDate: "2026-11-16", seed: 4
    })[0]!;
    const zero = forecastEpics(groups, history, {
      ...TEST_SETTINGS, unrefinedTicketsPerEpic: 0
    }, { startDate: "2026-11-16", seed: 4 })[0]!;
    expect(reserved.forecast?.issueCount).toBe(1);
    expect(reserved.forecast?.dataConfidence).toBe("low");
    expect(zero.forecast).toBeUndefined();
  });
});

describe("important work alerts", () => {
  const epic: TicketFeatures = {
    id: "epic-alert",
    key: "DEMO-200",
    summary: "Priority rollout",
    issueType: "Epic",
    priority: "High",
    labels: [],
    components: [],
    status: "In Progress",
    createdAt: "2026-11-01T00:00:00.000Z",
    sprintNames: []
  };
  const child: TicketFeatures = {
    ...goal[0]!,
    key: "DEMO-201",
    priority: "Medium",
    labels: ["important"],
    dueDate: "2026-11-25"
  };
  const forecast = forecastGoal([child], history, {
    ...TEST_SETTINGS, agilityMethod: "scrum"
  }, { startDate: "2026-11-16", seed: 3 });
  forecast.milestones.production.p80 = "2026-12-04";
  const group = { epic, children: [child] };
  const epicForecast = {
    epic,
    totalChildren: 1,
    completedChildren: 0,
    remainingChildren: 1,
    reserveTickets: 0,
    forecast
  };

  it("uses a Jira due date for important ticket scope", () => {
    const alerts = importantWorkAlerts([group], [epicForecast], TEST_SETTINGS, "2026-11-16");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      state: "risk",
      targetSource: "due-date",
      targetDate: "2026-11-25",
      forecastDate: "2026-12-04",
      importantTicketKeys: ["DEMO-201"]
    });
  });

  it("changes the sprint watch when sprint length changes", () => {
    const noDueDateChild = { ...child };
    delete noDueDateChild.dueDate;
    const noDueDate = { epic, children: [noDueDateChild] };
    const oneWeek = importantWorkAlerts([noDueDate], [epicForecast], {
      ...TEST_SETTINGS, sprintLengthWeeks: 1, importantTargetSprints: 2
    }, "2026-11-16");
    const twoWeeks = importantWorkAlerts([noDueDate], [epicForecast], {
      ...TEST_SETTINGS, sprintLengthWeeks: 2, importantTargetSprints: 2
    }, "2026-11-16");
    expect(oneWeek[0]).toMatchObject({ state: "risk", targetDate: "2026-11-27" });
    expect(twoWeeks).toHaveLength(0);
  });
});

