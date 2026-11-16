import { Notice, Plugin } from "obsidian";
import { CalendarClient } from "./calendar/CalendarClient";
import { forecastGoal } from "./forecast/engine";
import { buildHistoricalIssues } from "./forecast/history";
import { JiraClient } from "./jira/JiraClient";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  PathToProdSettingTab,
  type PathToProdSettings
} from "./settings";
import type { ForecastResult, HistoricalIssue, LeavePeriod } from "./types";
import { FORECAST_VIEW_TYPE, ForecastView } from "./view/ForecastView";

interface PluginCache {
  history: HistoricalIssue[];
  lastSync?: string;
  calendar: {
    holidays: string[];
    leave: LeavePeriod[];
    lastSync?: string;
  };
}

interface StoredData {
  settings?: Partial<PathToProdSettings>;
  cache?: PluginCache;
}

export default class PathToProdPlugin extends Plugin {
  settings: PathToProdSettings = DEFAULT_SETTINGS;
  cache: PluginCache = { history: [], calendar: { holidays: [], leave: [] } };

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.registerView(
      FORECAST_VIEW_TYPE,
      (leaf) => new ForecastView(leaf, this)
    );
    this.addRibbonIcon("milestone", "Open Path to Prod", () => void this.activateView());
    this.addCommand({
      id: "open-forecast",
      name: "Open delivery forecast",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "sync-data",
      name: "Sync Jira and calendar data",
      callback: () =>
        void this.syncData().then((counts) => {
          new Notice(
            `Path to Prod synced ${counts.history} historical issues and ${counts.calendar} calendar entries.`
          );
        })
    });
    this.addSettingTab(new PathToProdSettingTab(this.app, this));
  }

  private async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as StoredData | null;
    this.settings = mergeSettings(data?.settings);
    this.cache = {
      history: data?.cache?.history ?? [],
      ...(data?.cache?.lastSync ? { lastSync: data.cache.lastSync } : {}),
      calendar: data?.cache?.calendar ?? { holidays: [], leave: [] }
    };
  }

  async savePluginData(): Promise<void> {
    await this.saveData({ settings: this.settings, cache: this.cache } satisfies StoredData);
  }

  private jiraClient(): JiraClient {
    return new JiraClient(this.settings);
  }

  async testJiraConnection(): Promise<string> {
    return this.jiraClient().testConnection();
  }

  async syncHistory(
    onProgress?: (completed: number, total: number) => void
  ): Promise<number> {
    const client = this.jiraClient();
    const issues = await client.searchIssues(
      this.settings.historyJql,
      this.settings.historyLimit
    );
    const changes = await client.getStatusChanges(issues, onProgress);
    this.cache = {
      history: buildHistoricalIssues(issues, changes, this.settings),
      lastSync: new Date().toISOString(),
      calendar: this.cache.calendar
    };
    await this.savePluginData();
    return this.cache.history.length;
  }

  async syncCalendars(): Promise<number> {
    const result = await new CalendarClient().sync(
      this.settings.holidayCalendarUrls,
      this.settings.crewCalendarFeeds
    );
    this.cache.calendar = {
      ...result,
      lastSync: new Date().toISOString()
    };
    await this.savePluginData();
    return result.holidays.length + result.leave.length;
  }

  async syncData(
    onProgress?: (completed: number, total: number) => void
  ): Promise<{ history: number; calendar: number }> {
    const history = await this.syncHistory(onProgress);
    const calendar = await this.syncCalendars();
    return { history, calendar };
  }

  async runForecast(): Promise<ForecastResult> {
    if (this.cache.history.length === 0) await this.syncHistory();
    if (
      !this.cache.calendar.lastSync &&
      (this.settings.holidayCalendarUrls.length > 0 ||
        this.settings.crewCalendarFeeds.length > 0)
    ) {
      await this.syncCalendars();
    }
    const goalIssues = await this.jiraClient().searchIssues(this.settings.goalJql, 500);
    const settings = {
      ...this.settings,
      holidays: [...new Set([...this.settings.holidays, ...this.cache.calendar.holidays])],
      leave: [...this.settings.leave, ...this.cache.calendar.leave]
    };
    return forecastGoal(goalIssues, this.cache.history, settings);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(FORECAST_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: FORECAST_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}

