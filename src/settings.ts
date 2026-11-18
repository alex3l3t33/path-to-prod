import { App, Notice, PluginSettingTab, SecretComponent } from "obsidian";
import type { Setting, SettingDefinition, SettingDefinitionItem } from "obsidian";
import type PathToProdPlugin from "./main";
import type {
  AgilityMethodSetting,
  CrewCalendarFeed,
  LeavePeriod,
  Stage
} from "./types";

export interface PathToProdSettings {
  jiraBaseUrl: string;
  jiraDeployment: "auto" | "cloud" | "data-center";
  jiraTokenHolder: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraTokenSecretId: string;
  jiraProjectKey: string;
  historyJql: string;
  goalJql: string;
  epicJql: string;
  unrefinedTicketsPerEpic: number;
  epicReserveOverrides: Record<string, number>;
  importantEpicKeys: string[];
  importantTicketKeys: string[];
  importantPriorities: string[];
  importantLabels: string[];
  importantTargetSprints: number;
  historyLimit: number;
  simulations: number;
  agilityMethod: AgilityMethodSetting;
  sprintLengthWeeks: number;
  sprintAnchorDate: string;
  scrumReleaseAtSprintEnd: boolean;
  useAssigneeHistory: boolean;
  teamSize: number;
  focusFactor: number;
  stageCapacity: Record<Stage, number>;
  fallbackDays: Record<Stage, number>;
  stageStatuses: Record<Stage, string[]>;
  doneStatuses: string[];
  holidays: string[];
  leave: LeavePeriod[];
  holidayCalendarUrls: string[];
  crewCalendarFeeds: CrewCalendarFeed[];
  releaseWeekdays: number[];
}

export const DEFAULT_SETTINGS: PathToProdSettings = {
  jiraBaseUrl: "",
  jiraDeployment: "auto",
  jiraTokenHolder: "",
  jiraEmail: "",
  jiraApiToken: "",
  jiraTokenSecretId: "",
  jiraProjectKey: "",
  historyJql:
    'project = "{{project}}" AND statusCategory = Done ORDER BY resolved DESC',
  goalJql:
    'project = "{{project}}" AND statusCategory != Done ORDER BY priority DESC',
  epicJql:
    'project = "{{project}}" AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC',
  unrefinedTicketsPerEpic: 1,
  epicReserveOverrides: {},
  importantEpicKeys: [],
  importantTicketKeys: [],
  importantPriorities: ["Highest", "High", "Critical", "Blocker"],
  importantLabels: ["important"],
  importantTargetSprints: 2,
  historyLimit: 200,
  simulations: 2000,
  agilityMethod: "auto",
  sprintLengthWeeks: 2,
  sprintAnchorDate: "",
  scrumReleaseAtSprintEnd: false,
  useAssigneeHistory: true,
  teamSize: 5,
  focusFactor: 0.7,
  stageCapacity: {
    development: 3,
    staging: 2,
    production: 1
  },
  fallbackDays: {
    development: 3,
    staging: 2,
    production: 1
  },
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

export function mergeSettings(
  stored: Partial<PathToProdSettings> | undefined
): PathToProdSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    stageCapacity: {
      ...DEFAULT_SETTINGS.stageCapacity,
      ...stored?.stageCapacity
    },
    fallbackDays: {
      ...DEFAULT_SETTINGS.fallbackDays,
      ...stored?.fallbackDays
    },
    stageStatuses: {
      ...DEFAULT_SETTINGS.stageStatuses,
      ...stored?.stageStatuses
    },
    epicReserveOverrides: { ...stored?.epicReserveOverrides },
    importantEpicKeys: stored?.importantEpicKeys ?? [],
    importantTicketKeys: stored?.importantTicketKeys ?? [],
    importantPriorities: stored?.importantPriorities ?? DEFAULT_SETTINGS.importantPriorities,
    importantLabels: stored?.importantLabels ?? DEFAULT_SETTINGS.importantLabels
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDateLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseLeaveLines(value: string): LeavePeriod[] {
  const leave: LeavePeriod[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [person, start, end] = line.split("|").map((part) => part.trim());
    if (!person || !start || !end) continue;
    leave.push({ person, start, end });
  }
  return leave;
}

function parseCrewFeedLines(value: string): CrewCalendarFeed[] {
  const feeds: CrewCalendarFeed[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf("|");
    if (separator < 0) continue;
    const person = line.slice(0, separator).trim();
    const url = line.slice(separator + 1).trim();
    if (person && url) feeds.push({ person, url });
  }
  return feeds;
}

function numberOr(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class PathToProdSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PathToProdPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const item = (
      name: string,
      desc: string | undefined,
      renderSetting: (setting: Setting) => unknown
    ): SettingDefinition => ({
      name,
      ...(desc ? { desc } : {}),
      render: (setting) => {
        renderSetting(setting);
      }
    });
    const save = () => this.plugin.savePluginData();
    const stages = ["development", "staging", "production"] as const;
    const title = (value: string) => `${value[0]?.toUpperCase()}${value.slice(1)}`;

    const jiraItems: SettingDefinition[] = [
      item("Jira site URL", "Use the company-approved HTTPS Jira API base URL. The token is sent to this host. A proxy path such as /jira is supported; do not enter a board or issue page.", (setting) =>
        setting.addText((text) =>
          text.setPlaceholder("https://company.atlassian.net").setValue(this.plugin.settings.jiraBaseUrl).onChange((value) => {
            this.plugin.settings.jiraBaseUrl = value.trim();
            void save();
          })
        )
      ),
      item("Jira deployment", "Auto uses Cloud for Atlassian hosts and Data Center/Server for other URLs. Choose Cloud manually if your company proxy hosts Jira Cloud on its own domain.", (setting) =>
        setting.addDropdown((dropdown) => dropdown
          .addOption("auto", "Auto detect")
          .addOption("data-center", "Data center / server")
          .addOption("cloud", "Atlassian cloud")
          .setValue(this.plugin.settings.jiraDeployment)
          .onChange((value) => {
            this.plugin.settings.jiraDeployment = value as PathToProdSettings["jiraDeployment"];
            void save();
          }))
      ),
      item("Token holder", "Human-readable owner of the Atlassian API token.", (setting) =>
        setting.addText((text) =>
          text.setPlaceholder("Token holder name").setValue(this.plugin.settings.jiraTokenHolder).onChange((value) => {
            this.plugin.settings.jiraTokenHolder = value.trim();
            void save();
          })
        )
      ),
      item("Atlassian email (optional)", "Leave blank when your Jira token works as a Bearer credential, as in a token-only Jira search setup. Atlassian Cloud API tokens using Basic authentication need the account email.", (setting) =>
        setting.addText((text) =>
          text.setValue(this.plugin.settings.jiraEmail).onChange((value) => {
            this.plugin.settings.jiraEmail = value.trim();
            void save();
          })
        )
      ),
      item("Jira token secret", "Select or create an Obsidian secret containing the Jira token. Only its secret name is saved in Path to Prod settings.", (setting) =>
        setting.addComponent((el) => new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.jiraTokenSecretId)
          .onChange((value) => {
            this.plugin.settings.jiraTokenSecretId = value ?? "";
            void save();
          }))
      ),
      item("Company Jira project", "Project key or exact project name used to replace {{project}} in JQL, for example ACME.", (setting) =>
        setting.addText((text) =>
          text.setPlaceholder("ACME").setValue(this.plugin.settings.jiraProjectKey).onChange((value) => {
            this.plugin.settings.jiraProjectKey = value.trim();
            void save();
          })
        )
      ),
      item("Test Jira connection", "Checks project issue search and, if an issue is found, changelog access used for forecasting. Proxy and SSO HTML is reported without displaying it.", (setting) =>
        setting.addButton((button) =>
          button.setButtonText("Test").onClick(async () => {
            button.setDisabled(true);
            try {
              const result = await this.plugin.testJiraConnection();
              new Notice(result.sampleIssueKey
                ? `Jira search and changelog work for ${result.project}; found ${result.sampleIssueKey}.`
                : `Jira search accepted project ${result.project}, but returned no visible issues. Check the project name and permissions.`, 12000);
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Jira connection failed.");
            } finally {
              button.setDisabled(false);
            }
          })
        )
      )
    ];

    const goalItems: SettingDefinition[] = [
      item("Completed-ticket JQL", "Used to learn historical stage durations. Use {{project}} for the configured Jira project.", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 3;
          text.setValue(this.plugin.settings.historyJql).onChange((value) => {
            this.plugin.settings.historyJql = value.trim();
            void save();
          });
        })
      ),
      item("Goal JQL", "Issues whose delivery dates are forecast. Use {{project}} for the configured Jira project.", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 3;
          text.setValue(this.plugin.settings.goalJql).onChange((value) => {
            this.plugin.settings.goalJql = value.trim();
            void save();
          });
        })
      ),
      item("Epic JQL", "Open epics to include in the Gantt view. Use {{project}} for the configured Jira project.", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 3;
          text.setValue(this.plugin.settings.epicJql).onChange((value) => {
            this.plugin.settings.epicJql = value.trim();
            void save();
          });
        })
      ),
      item("Unrefined tickets per epic", "Planning reserve for work not yet represented by Jira child tickets. Adjust each epic in the Gantt view.", (setting) =>
        setting.addText((text) =>
          text.setValue(String(this.plugin.settings.unrefinedTicketsPerEpic)).onChange((value) => {
            this.plugin.settings.unrefinedTicketsPerEpic = Math.min(50, Math.max(0, Math.round(numberOr(value, 1))));
            void save();
          })
        )
      ),
      item("Important priorities", "Jira priorities that mark an epic or ticket as important. Comma-separated, case-insensitive.", (setting) =>
        setting.addText((text) =>
          text.setValue(this.plugin.settings.importantPriorities.join(", ")).onChange((value) => {
            this.plugin.settings.importantPriorities = parseCsv(value);
            void save();
          })
        )
      ),
      item("Important labels", "Jira labels that mark an epic or ticket as important. Comma-separated, case-insensitive.", (setting) =>
        setting.addText((text) =>
          text.setValue(this.plugin.settings.importantLabels.join(", ")).onChange((value) => {
            this.plugin.settings.importantLabels = parseCsv(value);
            void save();
          })
        )
      ),
      item("Important work target", "When no Jira due date exists, watch whether P80 production for a marked epic extends beyond this many sprints. Applies in Scrum mode.", (setting) =>
        setting.addDropdown((dropdown) => {
          for (let count = 1; count <= 6; count += 1) dropdown.addOption(String(count), `${count} sprint${count === 1 ? "" : "s"}`);
          dropdown.setValue(String(this.plugin.settings.importantTargetSprints)).onChange((value) => {
            this.plugin.settings.importantTargetSprints = Number(value);
            void save();
          });
        })
      ),
      item("Historical issue limit", "Start with 100–300 completed issues from one stable team workflow.", (setting) =>
        setting.addText((text) =>
          text.setValue(String(this.plugin.settings.historyLimit)).onChange((value) => {
            this.plugin.settings.historyLimit = Math.max(20, Math.round(numberOr(value, DEFAULT_SETTINGS.historyLimit)));
            void save();
          })
        )
      )
    ];

    const workflowItems: SettingDefinition[] = stages.map((stage) =>
      item(`${title(stage)} statuses`, "Comma-separated Jira status names.", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 2;
          text.setValue(this.plugin.settings.stageStatuses[stage].join(", ")).onChange((value) => {
            this.plugin.settings.stageStatuses[stage] = parseCsv(value);
            void save();
          });
        })
      )
    );
    workflowItems.push(
      item("Completed statuses", "Comma-separated Jira status names that mean production is complete.", (setting) =>
        setting.addText((text) =>
          text.setValue(this.plugin.settings.doneStatuses.join(", ")).onChange((value) => {
            this.plugin.settings.doneStatuses = parseCsv(value);
            void save();
          })
        )
      )
    );

    const capacityItems: SettingDefinition[] = [
      item("Agility methodology", "Auto detects Scrum from Jira sprint assignments; Kanban keeps continuous-flow dates.", (setting) =>
        setting.addDropdown((dropdown) =>
          dropdown.addOption("auto", "Auto detect").addOption("scrum", "Scrum").addOption("kanban", "Kanban")
            .setValue(this.plugin.settings.agilityMethod).onChange((value) => {
              this.plugin.settings.agilityMethod = value as AgilityMethodSetting;
              void save();
              this.update();
            })
        )
      ),
      {
        ...item("Sprint length", "Length in weeks. Development forecasts align to a sprint boundary.", (setting) =>
          setting.addDropdown((dropdown) => {
            for (let weeks = 1; weeks <= 6; weeks += 1) dropdown.addOption(String(weeks), `${weeks} week${weeks === 1 ? "" : "s"}`);
            dropdown.setValue(String(this.plugin.settings.sprintLengthWeeks)).onChange((value) => {
              this.plugin.settings.sprintLengthWeeks = Number(value);
              void save();
            });
          })
        ),
        visible: () => this.plugin.settings.agilityMethod !== "kanban"
      },
      {
        ...item("Sprint anchor date", "Start of a known sprint in YYYY-MM-DD format. Leave blank to use Monday of the forecast week.", (setting) =>
          setting.addText((text) =>
            text.setPlaceholder("2026-11-16").setValue(this.plugin.settings.sprintAnchorDate).onChange((value) => {
              this.plugin.settings.sprintAnchorDate = value.trim();
              void save();
            })
          )
        ),
        visible: () => this.plugin.settings.agilityMethod !== "kanban"
      },
      {
        ...item("Release at sprint boundary", "In Scrum mode, hold production until the next sprint end before applying release weekdays.", (setting) =>
          setting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.scrumReleaseAtSprintEnd).onChange((value) => {
              this.plugin.settings.scrumReleaseAtSprintEnd = value;
              void save();
            })
          )
        ),
        visible: () => this.plugin.settings.agilityMethod !== "kanban"
      },
      item("Use developer history", "Give same-assignee tickets a small similarity boost and show historical throughput context. Team history remains the fallback.", (setting) =>
        setting.addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.useAssigneeHistory).onChange((value) => {
            this.plugin.settings.useAssigneeHistory = value;
            void save();
          })
        )
      ),
      item("Team size", undefined, (setting) =>
        setting.addText((text) =>
          text.setValue(String(this.plugin.settings.teamSize)).onChange((value) => {
            this.plugin.settings.teamSize = Math.max(1, Math.round(numberOr(value, DEFAULT_SETTINGS.teamSize)));
            void save();
          })
        )
      ),
      item("Focus factor", "Fraction of a workday available for goal work, from 0.1 to 1.", (setting) =>
        setting.addText((text) =>
          text.setValue(String(this.plugin.settings.focusFactor)).onChange((value) => {
            this.plugin.settings.focusFactor = Math.min(1, Math.max(0.1, numberOr(value, DEFAULT_SETTINGS.focusFactor)));
            void save();
          })
        )
      )
    ];
    capacityItems.push(...stages.map((stage) =>
      item(`${title(stage)} parallel capacity`, "Approximate number of tickets the team can actively handle at once.", (setting) =>
        setting.addText((text) =>
          text.setValue(String(this.plugin.settings.stageCapacity[stage])).onChange((value) => {
            this.plugin.settings.stageCapacity[stage] = Math.max(0.25, numberOr(value, DEFAULT_SETTINGS.stageCapacity[stage]));
            void save();
          })
        )
      )
    ));
    capacityItems.push(
      item("Holiday dates", "One YYYY-MM-DD date per line.", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 5;
          text.setValue(this.plugin.settings.holidays.join("\n")).onChange((value) => {
            this.plugin.settings.holidays = parseDateLines(value);
            void save();
          });
        })
      ),
      item("Crew leave", "One inclusive period per line: Person | YYYY-MM-DD | YYYY-MM-DD", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 6;
          text.setValue(this.plugin.settings.leave.map((entry) => `${entry.person} | ${entry.start} | ${entry.end}`).join("\n")).onChange((value) => {
            this.plugin.settings.leave = parseLeaveLines(value);
            void save();
          });
        })
      ),
      item("Holiday calendar feeds", "Optional HTTPS ICS URLs, one per line. All-day events are treated as non-working holidays.", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 4;
          text.setPlaceholder("https://calendar.example/holidays.ics").setValue(this.plugin.settings.holidayCalendarUrls.join("\n")).onChange((value) => {
            this.plugin.settings.holidayCalendarUrls = parseDateLines(value);
            void save();
          });
        })
      ),
      item("Crew calendar feeds", "Private all-day leave feeds: Person | HTTPS ICS URL. URLs may contain secret tokens and are stored in plugin data.", (setting) =>
        setting.addTextArea((text) => {
          text.inputEl.rows = 5;
          text.setPlaceholder("Ada | https://calendar.example/ada-leave.ics").setValue(this.plugin.settings.crewCalendarFeeds.map((feed) => `${feed.person} | ${feed.url}`).join("\n")).onChange((value) => {
            this.plugin.settings.crewCalendarFeeds = parseCrewFeedLines(value);
            void save();
          });
        })
      ),
      item("Production release weekdays", "Comma-separated ISO weekdays: 1 Monday … 7 Sunday.", (setting) =>
        setting.addText((text) =>
          text.setValue(this.plugin.settings.releaseWeekdays.join(", ")).onChange((value) => {
            this.plugin.settings.releaseWeekdays = parseCsv(value).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
            void save();
          })
        )
      )
    );

    return [
      { type: "group", heading: "Jira connection", items: jiraItems },
      { type: "group", heading: "Goals and history", items: goalItems },
      { type: "group", heading: "Workflow mapping", items: workflowItems },
      { type: "group", heading: "Capacity and calendars", items: capacityItems }
    ];
  }
}

