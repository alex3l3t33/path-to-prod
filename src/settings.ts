import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type PathToProdPlugin from "./main";
import type {
  AgilityMethodSetting,
  CrewCalendarFeed,
  LeavePeriod,
  Stage
} from "./types";

export interface PathToProdSettings {
  jiraBaseUrl: string;
  jiraTokenHolder: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
  historyJql: string;
  goalJql: string;
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
  jiraTokenHolder: "",
  jiraEmail: "",
  jiraApiToken: "",
  jiraProjectKey: "",
  historyJql:
    'project = "{{project}}" AND statusCategory = Done ORDER BY resolved DESC',
  goalJql:
    'project = "{{project}}" AND statusCategory != Done ORDER BY priority DESC',
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
    }
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Jira connection").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The MVP uses an Atlassian email and API token for a personal connection. The token is stored in this vault's plugin data. OAuth is required before a public multi-user release."
    });

    new Setting(containerEl)
      .setName("Jira site URL")
      .setDesc("For example, https://company.atlassian.net")
      .addText((text) =>
        text
          .setPlaceholder("https://company.atlassian.net")
          .setValue(this.plugin.settings.jiraBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.jiraBaseUrl = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Token holder")
      .setDesc("Human-readable owner of the Atlassian API token.")
      .addText((text) =>
        text
          .setPlaceholder("Token holder name")
          .setValue(this.plugin.settings.jiraTokenHolder)
          .onChange(async (value) => {
            this.plugin.settings.jiraTokenHolder = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Atlassian email")
      .setDesc("Email belonging to the token holder.")
      .addText((text) =>
        text.setValue(this.plugin.settings.jiraEmail).onChange(async (value) => {
          this.plugin.settings.jiraEmail = value.trim();
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("API token")
      .setDesc("Create a dedicated, revocable Atlassian API token.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.jiraApiToken).onChange(async (value) => {
          this.plugin.settings.jiraApiToken = value.trim();
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Company Jira project")
      .setDesc(
        "Project key used to replace {{project}} in the JQL variables, for example ACME."
      )
      .addText((text) =>
        text
          .setPlaceholder("ACME")
          .setValue(this.plugin.settings.jiraProjectKey)
          .onChange(async (value) => {
            this.plugin.settings.jiraProjectKey = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Test Jira connection")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          button.setDisabled(true);
          try {
            const name = await this.plugin.testJiraConnection();
            new Notice(`Connected to Jira as ${name}.`);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Jira connection failed.");
          } finally {
            button.setDisabled(false);
          }
        })
      );

    new Setting(containerEl).setName("Goals and history").setHeading();
    new Setting(containerEl)
      .setName("Completed-ticket JQL")
      .setDesc("Used to learn historical stage durations. Use {{project}} for the configured Jira project.")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.setValue(this.plugin.settings.historyJql).onChange(async (value) => {
          this.plugin.settings.historyJql = value.trim();
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Goal JQL")
      .setDesc("Issues whose delivery dates are forecast. Use {{project}} for the configured Jira project.")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.setValue(this.plugin.settings.goalJql).onChange(async (value) => {
          this.plugin.settings.goalJql = value.trim();
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Historical issue limit")
      .setDesc("Start with 100–300 completed issues from one stable team workflow.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.historyLimit))
          .onChange(async (value) => {
            this.plugin.settings.historyLimit = Math.max(
              20,
              Math.round(numberOr(value, DEFAULT_SETTINGS.historyLimit))
            );
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl).setName("Workflow mapping").setHeading();
    for (const stage of ["development", "staging", "production"] as const) {
      new Setting(containerEl)
        .setName(`${stage[0]?.toUpperCase()}${stage.slice(1)} statuses`)
        .setDesc("Comma-separated Jira status names.")
        .addTextArea((text) => {
          text.inputEl.rows = 2;
          text
            .setValue(this.plugin.settings.stageStatuses[stage].join(", "))
            .onChange(async (value) => {
              this.plugin.settings.stageStatuses[stage] = parseCsv(value);
              await this.plugin.savePluginData();
            });
        });
    }

    new Setting(containerEl)
      .setName("Completed statuses")
      .setDesc("Comma-separated Jira status names that mean production is complete.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.doneStatuses.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.doneStatuses = parseCsv(value);
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl).setName("Capacity and calendars").setHeading();
    new Setting(containerEl)
      .setName("Agility methodology")
      .setDesc(
        "Auto detects Scrum from Jira sprint assignments; Kanban keeps continuous-flow dates."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto detect")
          .addOption("scrum", "Scrum")
          .addOption("kanban", "Kanban")
          .setValue(this.plugin.settings.agilityMethod)
          .onChange(async (value) => {
            this.plugin.settings.agilityMethod = value as AgilityMethodSetting;
            await this.plugin.savePluginData();
            this.display();
          })
      );

    if (this.plugin.settings.agilityMethod !== "kanban") {
      new Setting(containerEl)
        .setName("Sprint length")
        .setDesc("Length in weeks. Development forecasts align to a sprint boundary.")
        .addDropdown((dropdown) => {
          for (let weeks = 1; weeks <= 6; weeks += 1) {
            dropdown.addOption(String(weeks), `${weeks} week${weeks === 1 ? "" : "s"}`);
          }
          dropdown
            .setValue(String(this.plugin.settings.sprintLengthWeeks))
            .onChange(async (value) => {
              this.plugin.settings.sprintLengthWeeks = Number(value);
              await this.plugin.savePluginData();
            });
        });

      new Setting(containerEl)
        .setName("Sprint anchor date")
        .setDesc(
          "Start of a known sprint in YYYY-MM-DD format. Leave blank to use Monday of the forecast week."
        )
        .addText((text) =>
          text
            .setPlaceholder("2026-11-16")
            .setValue(this.plugin.settings.sprintAnchorDate)
            .onChange(async (value) => {
              this.plugin.settings.sprintAnchorDate = value.trim();
              await this.plugin.savePluginData();
            })
        );

      new Setting(containerEl)
        .setName("Release at sprint boundary")
        .setDesc(
          "When enabled in Scrum mode, production is held until the next sprint end before applying release weekdays."
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.scrumReleaseAtSprintEnd)
            .onChange(async (value) => {
              this.plugin.settings.scrumReleaseAtSprintEnd = value;
              await this.plugin.savePluginData();
            })
        );
    }

    new Setting(containerEl)
      .setName("Use developer history")
      .setDesc(
        "Give same-assignee tickets a small similarity boost and show historical throughput context. Team history remains the fallback."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useAssigneeHistory)
          .onChange(async (value) => {
            this.plugin.settings.useAssigneeHistory = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Team size")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.teamSize)).onChange(async (value) => {
          this.plugin.settings.teamSize = Math.max(
            1,
            Math.round(numberOr(value, DEFAULT_SETTINGS.teamSize))
          );
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Focus factor")
      .setDesc("Fraction of a workday available for goal work, from 0.1 to 1.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.focusFactor))
          .onChange(async (value) => {
            const parsed = numberOr(value, DEFAULT_SETTINGS.focusFactor);
            this.plugin.settings.focusFactor = Math.min(1, Math.max(0.1, parsed));
            await this.plugin.savePluginData();
          })
      );

    for (const stage of ["development", "staging", "production"] as const) {
      new Setting(containerEl)
        .setName(`${stage[0]?.toUpperCase()}${stage.slice(1)} parallel capacity`)
        .setDesc("Approximate number of tickets the team can actively handle at once.")
        .addText((text) =>
          text
            .setValue(String(this.plugin.settings.stageCapacity[stage]))
            .onChange(async (value) => {
              this.plugin.settings.stageCapacity[stage] = Math.max(
                0.25,
                numberOr(value, DEFAULT_SETTINGS.stageCapacity[stage])
              );
              await this.plugin.savePluginData();
            })
        );
    }

    new Setting(containerEl)
      .setName("Holiday dates")
      .setDesc("One YYYY-MM-DD date per line.")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.setValue(this.plugin.settings.holidays.join("\n")).onChange(async (value) => {
          this.plugin.settings.holidays = parseDateLines(value);
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Crew leave")
      .setDesc("One inclusive period per line: Person | YYYY-MM-DD | YYYY-MM-DD")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text
          .setValue(
            this.plugin.settings.leave
              .map((entry) => `${entry.person} | ${entry.start} | ${entry.end}`)
              .join("\n")
          )
          .onChange(async (value) => {
            this.plugin.settings.leave = parseLeaveLines(value);
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Holiday calendar feeds")
      .setDesc(
        "Optional HTTPS ICS URLs, one per line. All-day events are treated as non-working holidays."
      )
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setPlaceholder("https://calendar.example/holidays.ics")
          .setValue(this.plugin.settings.holidayCalendarUrls.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.holidayCalendarUrls = parseDateLines(value);
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Crew calendar feeds")
      .setDesc(
        "Optional private all-day leave feeds: Person | HTTPS ICS URL. Feed URLs may contain secret access tokens and are stored in plugin data."
      )
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text
          .setPlaceholder("Ada | https://calendar.example/ada-leave.ics")
          .setValue(
            this.plugin.settings.crewCalendarFeeds
              .map((feed) => `${feed.person} | ${feed.url}`)
              .join("\n")
          )
          .onChange(async (value) => {
            this.plugin.settings.crewCalendarFeeds = parseCrewFeedLines(value);
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Production release weekdays")
      .setDesc("Comma-separated ISO weekdays: 1 Monday … 7 Sunday.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.releaseWeekdays.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.releaseWeekdays = parseCsv(value)
              .map(Number)
              .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
            await this.plugin.savePluginData();
          })
      );
  }
}

