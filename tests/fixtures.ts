import type { PathToProdSettings } from "../src/settings";

export const TEST_SETTINGS: PathToProdSettings = {
  jiraBaseUrl: "",
  jiraTokenHolder: "Test User",
  jiraEmail: "",
  jiraApiToken: "",
  jiraProjectKey: "DEMO",
  historyJql: "project = DEMO AND statusCategory = Done",
  goalJql: "project = DEMO AND statusCategory != Done",
  historyLimit: 200,
  simulations: 200,
  agilityMethod: "auto",
  sprintLengthWeeks: 2,
  sprintAnchorDate: "2026-11-16",
  scrumReleaseAtSprintEnd: false,
  useAssigneeHistory: true,
  teamSize: 5,
  focusFactor: 0.7,
  stageCapacity: { development: 3, staging: 2, production: 1 },
  fallbackDays: { development: 3, staging: 2, production: 1 },
  stageStatuses: {
    development: ["In Progress", "Code Review"],
    staging: ["Ready for QA", "QA", "Testing", "Staging", "UAT"],
    production: ["Ready for Release", "Ready for Production", "Deploying"]
  },
  doneStatuses: ["Done", "Closed", "Released"],
  holidays: [],
  leave: [],
  holidayCalendarUrls: [],
  crewCalendarFeeds: [],
  releaseWeekdays: [2, 4]
};

