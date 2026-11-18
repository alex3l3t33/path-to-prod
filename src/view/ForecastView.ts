import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type PathToProdPlugin from "../main";
import type { DeveloperWorkload, EpicForecast, EpicGroup, ForecastResult, Stage } from "../types";
import { STAGES } from "../types";
import { importantWorkAlerts, isImportantIssue } from "../forecast/alerts";
import { mondayOfIsoWeek, weekLabel } from "../forecast/weeks";
import { buildEmailReport, copyEmailReport, type EmailReport } from "../export/emailReport";

export const FORECAST_VIEW_TYPE = "path-to-prod-forecast";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(`${value}T12:00:00`)
  );
}

function stageLabel(stage: Stage): string {
  return stage[0]?.toUpperCase() + stage.slice(1);
}

function daysFromNow(value: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(
    0,
    Math.ceil((new Date(`${value}T00:00:00`).getTime() - now.getTime()) / 86_400_000)
  );
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("") || "?";
}

function utcDay(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00.000Z`)
  );
}

function todayLocalKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export class ForecastView extends ItemView {
  private result?: ForecastResult;
  private busy = false;
  private status = "Configure Jira, then sync historical tickets.";
  private activeDashboard: "overview" | "developers" = "overview";
  private selectedDeveloperId: string | undefined;
  private viewMode: "goal" | "epics" = "goal";
  private epicGroups: EpicGroup[] = [];
  private epicForecasts: EpicForecast[] | undefined;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: PathToProdPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return FORECAST_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Path to Prod";
  }

  getIcon(): string {
    return "milestone";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("path-to-prod-view");

    const header = container.createDiv({ cls: "path-to-prod-header" });
    const titleBlock = header.createDiv();
    const brand = titleBlock.createDiv({ cls: "path-to-prod-brand" });
    brand.createSpan({ cls: "path-to-prod-brand-mark", text: "P" });
    brand.createEl("h1", { text: "Path to Prod" });
    titleBlock.createEl("p", {
      text: "A confidence-aware runway from Jira backlog to production."
    });

    const actions = header.createDiv({ cls: "path-to-prod-actions" });
    if (this.viewMode === "goal" ? Boolean(this.result) : Boolean(this.epicForecasts)) {
      const draftButton = actions.createEl("button", { text: "Email draft", attr: { type: "button" } });
      draftButton.disabled = this.busy;
      draftButton.addEventListener("click", () => void this.copyCurrentEmailReport(true));
      const emailButton = actions.createEl("button", { text: "Copy for email", attr: { type: "button" } });
      emailButton.disabled = this.busy;
      emailButton.addEventListener("click", () => void this.copyCurrentEmailReport(false));
    }
    const syncButton = actions.createEl("button", { text: "Sync data" });
    syncButton.disabled = this.busy;
    syncButton.addEventListener("click", () => void this.sync());
    const forecastButton = actions.createEl("button", {
      text: this.viewMode === "epics" ? "Forecast epics" : "Run forecast",
      cls: "mod-cta"
    });
    forecastButton.disabled = this.busy;
    forecastButton.addEventListener("click", () => void (this.viewMode === "epics" ? this.forecastEpics() : this.forecast()));

    container.createDiv({ cls: "path-to-prod-status", text: this.status });

    const tabs = container.createDiv({ cls: "path-to-prod-view-tabs", attr: { role: "tablist", "aria-label": "Forecast view" } });
    for (const [mode, label] of [["goal", "Goal overview"], ["epics", "Epic timeline"]] as const) {
      const button = tabs.createEl("button", {
        text: label,
        cls: mode === this.viewMode ? "is-active" : "",
        attr: { type: "button", role: "tab", "aria-selected": String(mode === this.viewMode) }
      });
      button.addEventListener("click", () => {
        this.viewMode = mode;
        this.render();
      });
    }

    if (this.viewMode === "epics") {
      this.renderEpicDashboard(container);
      return;
    }

    if (!this.result) {
      const empty = container.createDiv({ cls: "path-to-prod-empty" });
      empty.createDiv({ cls: "path-to-prod-empty-icon", text: "→" });
      empty.createEl("h2", { text: "Forecast a Jira goal" });
      empty.createEl("p", {
        text: "Path to Prod learns elapsed working time from completed tickets. Story points are optional."
      });
      return;
    }

    if (this.activeDashboard === "developers") {
      this.renderDeveloperDashboard(container);
      return;
    }

    const hero = container.createDiv({ cls: "path-to-prod-hero" });
    const heroCopy = hero.createDiv({ cls: "path-to-prod-hero-copy" });
    const methodLine = heroCopy.createDiv({ cls: "path-to-prod-method-line" });
    methodLine.createSpan({
      cls: `path-to-prod-method path-to-prod-method-${this.result.methodology}`,
      text:
        this.result.methodology === "scrum"
          ? `Scrum · ${this.result.sprintLengthWeeks}-week sprint`
          : "Kanban · continuous flow"
    });
    methodLine.createSpan({
      cls: `path-to-prod-confidence path-to-prod-confidence-${this.result.dataConfidence}`,
      text: `${this.result.dataConfidence} data confidence`
    });
    heroCopy.createDiv({ cls: "path-to-prod-eyebrow", text: "P80 production forecast" });
    heroCopy.createDiv({
      cls: "path-to-prod-hero-date",
      text: formatDate(this.result.milestones.production.p80)
    });
    heroCopy.createEl("p", {
      text: `${daysFromNow(this.result.milestones.production.p80)} calendar days from today, using ${this.result.historicalIssueCount} completed Jira issues.`
    });

    const orbit = hero.createDiv({ cls: "path-to-prod-orbit" });
    const orbitInner = orbit.createDiv();
    orbitInner.createEl("strong", { text: "80%" });
    orbitInner.createSpan({ text: "Confidence" });

    const summary = container.createDiv({ cls: "path-to-prod-summary" });
    const summaryValues: Array<{
      value: string;
      label: string;
      action?: () => void;
    }> = [
      { value: String(this.result.issueCount), label: "Goal issues" },
      {
        value: String(this.result.currentStageCounts.development),
        label: "In development",
        action: () => {
          this.activeDashboard = "developers";
          this.selectedDeveloperId = this.result?.developerWorkloads[0]?.id;
          this.render();
        }
      },
      { value: String(this.result.currentStageCounts.staging), label: "In staging" },
      {
        value: String(this.result.currentStageCounts.production),
        label: "Release ready"
      }
    ];
    for (const item of summaryValues) {
      const metric = item.action
        ? summary.createEl("button", {
            cls: "path-to-prod-metric path-to-prod-metric-action",
            attr: { type: "button", "aria-label": "Open development ownership" }
          })
        : summary.createDiv({ cls: "path-to-prod-metric" });
      metric.createEl("strong", { text: item.value });
      metric.createSpan({ text: item.label });
      if (item.action) {
        metric.createSpan({ cls: "path-to-prod-metric-hint", text: "View owners →" });
        metric.addEventListener("click", item.action);
      }
    }

    const timelineSection = container.createDiv({ cls: "path-to-prod-panel" });
    const timelineHeader = timelineSection.createDiv({ cls: "path-to-prod-section-header" });
    timelineHeader.createEl("h2", { text: "Delivery runway" });
    timelineHeader.createSpan({ text: "P80 plan · ranges remain visible" });
    const grid = timelineSection.createDiv({ cls: "path-to-prod-grid" });
    for (const stage of STAGES) {
      const card = grid.createDiv({ cls: "path-to-prod-card" });
      const cardTop = card.createDiv({ cls: "path-to-prod-card-top" });
      cardTop.createSpan({
        cls: "path-to-prod-stage-number",
        text: String(STAGES.indexOf(stage) + 1).padStart(2, "0")
      });
      cardTop.createEl("h3", { text: stageLabel(stage) });
      const milestone = this.result.milestones[stage];
      const primary = card.createDiv({ cls: "path-to-prod-primary-date" });
      primary.createEl("strong", { text: formatDate(milestone.p80) });
      const ranges = card.createDiv({ cls: "path-to-prod-ranges" });
      const likely = ranges.createDiv();
      likely.createSpan({ text: "P50" });
      likely.createEl("strong", { text: formatDate(milestone.p50) });
      const conservative = ranges.createDiv();
      conservative.createSpan({ text: "P95" });
      conservative.createEl("strong", { text: formatDate(milestone.p95) });
      card.createDiv({
        cls: "path-to-prod-samples",
        text: `${this.result.sampleCounts[stage]} historical stage samples`
      });
    }

    const detailGrid = container.createDiv({ cls: "path-to-prod-detail-grid" });
    const methodPanel = detailGrid.createDiv({ cls: "path-to-prod-panel" });
    const methodHeader = methodPanel.createDiv({ cls: "path-to-prod-section-header" });
    methodHeader.createEl("h2", { text: "Method fit" });
    const methodBody = methodPanel.createDiv({ cls: "path-to-prod-method-body" });
    methodBody.createEl("strong", {
      text: this.result.methodology === "scrum" ? "Sprint-aware" : "Flow-aware"
    });
    methodBody.createEl("p", { text: this.result.methodologyReason });
    methodBody.createEl("p", {
      text:
        this.result.methodology === "scrum"
          ? "Development is rounded to the configured sprint boundary. Staging and release capacity remain calendar-aware."
          : "Dates use continuous cycle-time sampling, WIP-style parallel capacity, and release windows."
    });
    const availability = methodBody.createDiv({ cls: "path-to-prod-availability" });
    availability.createSpan({ text: `${this.result.holidayCount} holiday days` });
    availability.createSpan({ text: `${this.result.leavePeriodCount} crew leave periods` });

    const confidencePanel = detailGrid.createDiv({ cls: "path-to-prod-panel" });
    const confidenceHeader = confidencePanel.createDiv({ cls: "path-to-prod-section-header" });
    confidenceHeader.createEl("h2", { text: "Production range" });
    const confidenceRows = confidencePanel.createDiv({ cls: "path-to-prod-confidence-rows" });
    for (const [label, value, width] of [
      ["P50 likely", this.result.milestones.production.p50, "50%"],
      ["P80 planning", this.result.milestones.production.p80, "80%"],
      ["P95 conservative", this.result.milestones.production.p95, "95%"]
    ] as const) {
      const row = confidenceRows.createDiv();
      const rowLabel = row.createDiv();
      rowLabel.createSpan({ text: label });
      rowLabel.createEl("strong", { text: formatDate(value) });
      const track = row.createDiv({ cls: "path-to-prod-bar-track" });
      const bar = track.createDiv({ cls: "path-to-prod-bar" });
      bar.style.width = width;
    }

    if (this.result.warnings.length > 0) {
      const warning = container.createDiv({ cls: "path-to-prod-warning" });
      warning.createEl("h2", { text: "Data quality" });
      const list = warning.createEl("ul");
      for (const message of this.result.warnings) list.createEl("li", { text: message });
    }
  }

  private renderEpicDashboard(container: HTMLElement): void {
    const forecasts = this.epicForecasts;
    if (!forecasts) {
      const empty = container.createDiv({ cls: "path-to-prod-empty path-to-prod-epic-empty" });
      empty.createDiv({ cls: "path-to-prod-empty-icon", text: "▤" });
      empty.createEl("h2", { text: "See the full epic runway" });
      empty.createEl("p", {
        text: "Bring in open epics and their Jira children. A planning reserve covers work that has not been broken into tickets yet."
      });
      const button = empty.createEl("button", { text: "Forecast epics", cls: "mod-cta" });
      button.disabled = this.busy;
      button.addEventListener("click", () => void this.forecastEpics());
      return;
    }
    if (forecasts.length === 0) {
      const empty = container.createDiv({ cls: "path-to-prod-empty" });
      empty.createEl("h2", { text: "No open epics found" });
      empty.createEl("p", { text: "Adjust epic JQL in the plugin settings, then forecast again." });
      return;
    }

    const dated = forecasts.filter((epic) => epic.forecast);
    const horizon = dated.map((epic) => epic.forecast?.milestones.production.p80 ?? "").sort().at(-1);
    const totalReserve = forecasts.reduce((sum, epic) => sum + epic.reserveTickets, 0);
    const heading = container.createDiv({ cls: "path-to-prod-epic-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createDiv({ cls: "path-to-prod-eyebrow", text: "Portfolio forecast · P80" });
    headingCopy.createEl("h2", { text: "Epic delivery map" });
    headingCopy.createEl("p", {
      text: "Each epic uses the configured team capacity independently. Bars show the P80 stage dates; the dashed tail reaches P95."
    });
    const horizonBlock = heading.createDiv({ cls: "path-to-prod-epic-horizon" });
    horizonBlock.createSpan({ text: "Latest P80 production" });
    horizonBlock.createEl("strong", { text: horizon ? formatDate(horizon) : "No remaining scope" });

    const stats = container.createDiv({ cls: "path-to-prod-epic-stats" });
    for (const [value, label] of [
      [forecasts.length, "Open epics"],
      [forecasts.reduce((sum, epic) => sum + epic.remainingChildren, 0), "Known tickets left"],
      [totalReserve, "Unrefined reserve"]
    ] as const) {
      const stat = stats.createDiv();
      stat.createEl("strong", { text: String(value) });
      stat.createSpan({ text: label });
    }

    const scrumActive = dated.some((epic) => epic.forecast?.methodology === "scrum");
    if (scrumActive) {
      const planning = container.createDiv({ cls: "path-to-prod-epic-planning" });
      const copy = planning.createDiv();
      copy.createEl("strong", { text: "Sprint watch" });
      copy.createSpan({ text: "Important work is watched against a configurable sprint target unless Jira has a due date." });
      const controls = planning.createDiv({ cls: "path-to-prod-epic-planning-controls" });
      const sprintLabel = controls.createEl("label");
      sprintLabel.createSpan({ text: "Sprint length" });
      const sprintLength = sprintLabel.createEl("select", { attr: { "aria-label": "Sprint length in weeks" } });
      for (let weeks = 1; weeks <= 6; weeks += 1) {
        sprintLength.createEl("option", { text: `${weeks} week${weeks === 1 ? "" : "s"}`, value: String(weeks) });
      }
      sprintLength.value = String(this.plugin.settings.sprintLengthWeeks);
      sprintLength.addEventListener("change", () => {
        this.plugin.settings.sprintLengthWeeks = Number(sprintLength.value);
        void this.plugin.savePluginData();
        this.refreshEpicForecast(container);
      });
      const targetLabel = controls.createEl("label");
      targetLabel.createSpan({ text: "Important target" });
      const target = targetLabel.createEl("select", { attr: { "aria-label": "Important work target in sprints" } });
      for (let count = 1; count <= 6; count += 1) {
        target.createEl("option", { text: `${count} sprint${count === 1 ? "" : "s"}`, value: String(count) });
      }
      target.value = String(this.plugin.settings.importantTargetSprints);
      target.addEventListener("change", () => {
        this.plugin.settings.importantTargetSprints = Number(target.value);
        void this.plugin.savePluginData();
        this.rerenderEpicDashboard(container);
      });
    }

    const alerts = importantWorkAlerts(this.epicGroups, forecasts, this.plugin.settings, todayLocalKey());
    const hasImportantWork = this.epicGroups.some((group) =>
      isImportantIssue(group.epic, this.plugin.settings) ||
      group.children.some((child) => isImportantIssue(child, this.plugin.settings))
    );
    const watch = container.createDiv({ cls: "path-to-prod-epic-watch" });
    const watchHeading = watch.createDiv({ cls: "path-to-prod-epic-watch-heading" });
    watchHeading.createEl("h3", { text: "Important work watch" });
    watchHeading.createSpan({ text: `${alerts.filter((alert) => alert.state === "risk").length} at risk` });
    if (alerts.length === 0) {
      watch.createEl("p", { text: hasImportantWork
        ? "Important work is within its current targets. The epic P80 is used as a scope-level signal for marked tickets."
        : "Mark an epic or ticket as important below, or configure Jira priorities and labels to watch." });
    } else {
      const list = watch.createEl("ul");
      for (const alert of alerts) {
        const item = list.createEl("li", { cls: `path-to-prod-epic-alert is-${alert.state}` });
        const subject = item.createDiv();
        subject.createEl("strong", { text: `${alert.epicKey} · ${alert.epicSummary}` });
        subject.createSpan({ text: alert.epicMarkedImportant
          ? alert.importantTicketKeys.length > 0 ? `Important epic · ${alert.importantTicketKeys.length} important tickets` : "Important epic"
          : `${alert.importantTicketKeys.length} important tickets: ${alert.importantTicketKeys.join(", ")}` });
        item.createSpan({ text: alert.state === "needs-estimate"
          ? "Add an unrefined reserve to forecast this epic"
          : alert.state === "needs-target"
            ? "Add a Jira due date to watch this Kanban epic"
            : `Epic P80 production ${formatDate(alert.forecastDate!)} · ${alert.targetSource === "due-date" ? "Jira due" : "Sprint target"} ${formatDate(alert.targetDate!)}` });
      }
    }

    const panel = container.createDiv({ cls: "path-to-prod-epic-panel" });
    const panelHeader = panel.createDiv({ cls: "path-to-prod-epic-panel-header" });
    panelHeader.createEl("h3", { text: "Delivery timeline" });
    const legend = panelHeader.createDiv({ cls: "path-to-prod-epic-legend" });
    for (const stage of STAGES) {
      const entry = legend.createSpan();
      entry.createSpan({ cls: `path-to-prod-legend-dot path-to-prod-stage-${stage}` });
      entry.createSpan({ text: stageLabel(stage) });
    }
    const tailLegend = legend.createSpan();
    tailLegend.createSpan({ cls: "path-to-prod-legend-tail" });
    tailLegend.createSpan({ text: "P80–P95" });
    const milestoneLegend = legend.createSpan();
    milestoneLegend.createSpan({ cls: "path-to-prod-legend-milestone" });
    milestoneLegend.createSpan({ text: "P80 milestone" });

    const today = todayLocalKey();
    const axisStart = mondayOfIsoWeek(today);
    const startDay = utcDay(axisStart);
    const maxP95 = dated.map((epic) => epic.forecast?.milestones.production.p95 ?? today)
      .reduce((latest, value) => value > latest ? value : latest, today);
    const daySpan = Math.max(14, utcDay(maxP95) - startDay + 7);
    const weekCount = Math.ceil(daySpan / 7);
    const width = Math.max(880, weekCount * 112);
    const position = (value: string) => Math.min(100, Math.max(0, ((utcDay(value) - startDay) / daySpan) * 100));
    const ordered = [...forecasts].sort((left, right) =>
      (left.forecast?.milestones.production.p80 ?? "9999-12-31").localeCompare(
        right.forecast?.milestones.production.p80 ?? "9999-12-31"
      )
    );

    const scroll = panel.createDiv({ cls: "path-to-prod-epic-scroll" });
    const chart = scroll.createDiv({ cls: "path-to-prod-epic-chart" });
    chart.style.setProperty("--p2p-chart-width", `${width}px`);
    const axis = chart.createDiv({ cls: "path-to-prod-epic-axis" });
    axis.createDiv({ cls: "path-to-prod-epic-axis-title", text: "Epic / scope" });
    const axisTrack = axis.createDiv({ cls: "path-to-prod-epic-axis-track" });
    for (let week = 0; week < weekCount; week += 1) {
      const date = new Date((startDay + week * 7) * 86_400_000).toISOString().slice(0, 10);
      const marker = axisTrack.createSpan();
      marker.createEl("strong", { text: weekLabel(date) });
      marker.createEl("small", { text: shortDate(date) });
      marker.style.left = `${(week * 7 / daySpan) * 100}%`;
      marker.style.width = `${(7 / daySpan) * 100}%`;
    }

    for (const epic of ordered) {
      const row = chart.createDiv({ cls: "path-to-prod-epic-row" });
      const info = row.createDiv({ cls: "path-to-prod-epic-info" });
      info.createSpan({ cls: "path-to-prod-epic-key", text: epic.epic.key });
      info.createEl("strong", { text: epic.epic.summary });
      info.createSpan({
        cls: "path-to-prod-epic-scope",
        text: `${epic.completedChildren}/${epic.totalChildren} completed · ${epic.remainingChildren} remaining`
      });
      const important = info.createEl("label", { cls: "path-to-prod-epic-important" });
      const importantInput = important.createEl("input", { type: "checkbox" });
      importantInput.checked = this.plugin.settings.importantEpicKeys.includes(epic.epic.key);
      importantInput.addEventListener("change", () => this.updateImportantKey("importantEpicKeys", epic.epic.key, importantInput.checked, container));
      important.createSpan({ text: "Mark important" });
      if (isImportantIssue(epic.epic, this.plugin.settings) && !importantInput.checked) {
        important.createSpan({ cls: "path-to-prod-epic-auto-mark", text: "Jira priority / label" });
      }
      const reserve = info.createEl("label", { cls: "path-to-prod-epic-reserve" });
      reserve.createSpan({ text: "Unrefined reserve" });
      const input = reserve.createEl("input", {
        type: "number",
        attr: { min: "0", max: "50", step: "1", "aria-label": `Unrefined tickets for ${epic.epic.key}` }
      });
      input.value = String(epic.reserveTickets);
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        this.plugin.settings.epicReserveOverrides[epic.epic.key] = Math.min(50, Math.max(0, Math.round(value)));
        void this.plugin.savePluginData();
        this.refreshEpicForecast(container);
      });

      const lane = row.createDiv({ cls: "path-to-prod-epic-lane", attr: {
        role: "img",
        "aria-label": epic.forecast
          ? `${epic.epic.key}: development ${formatDate(epic.forecast.milestones.development.p80)}, staging ${formatDate(epic.forecast.milestones.staging.p80)}, production ${formatDate(epic.forecast.milestones.production.p80)} at P80`
          : `${epic.epic.key}: no remaining scope to forecast`
      } });
      for (let tick = 0; tick < weekCount; tick += 1) {
        const line = lane.createSpan({ cls: "path-to-prod-epic-gridline" });
        line.style.left = `${(tick * 7 / daySpan) * 100}%`;
      }
      const todayLine = lane.createSpan({ cls: "path-to-prod-epic-today" });
      todayLine.style.left = `${position(today)}%`;
      todayLine.setAttribute("aria-hidden", "true");
      if (!epic.forecast) {
        lane.createSpan({ cls: "path-to-prod-epic-no-scope", text: "No remaining scope" });
        continue;
      }
      const milestones = epic.forecast.milestones;
      const bounds: Array<[Stage, number, number]> = [
        ["development", position(today), position(milestones.development.p80)],
        ["staging", position(milestones.development.p80), position(milestones.staging.p80)],
        ["production", position(milestones.staging.p80), position(milestones.production.p80)]
      ];
      for (const [stage, left, right] of bounds) {
        if (right > left) {
          const bar = lane.createSpan({ cls: `path-to-prod-epic-bar path-to-prod-stage-${stage}` });
          bar.style.left = `${left}%`;
          bar.style.width = `${right - left}%`;
          bar.setAttribute("title", `${stageLabel(stage)} P80: ${formatDate(milestones[stage].p80)}`);
          if (right - left >= 11) bar.createSpan({ text: stageLabel(stage) });
        }
        const marker = lane.createSpan({ cls: `path-to-prod-epic-milestone-marker is-${stage}` });
        marker.style.left = `${right}%`;
        marker.setAttribute("title", `${stageLabel(stage)} P80: ${formatDate(milestones[stage].p80)}`);
        marker.setAttribute("aria-hidden", "true");
      }
      const tailStart = position(milestones.production.p80);
      const tailEnd = position(milestones.production.p95);
      if (tailEnd > tailStart) {
        const tail = lane.createSpan({ cls: "path-to-prod-epic-tail" });
        tail.style.left = `${tailStart}%`;
        tail.style.width = `${tailEnd - tailStart}%`;
        tail.setAttribute("title", `Production P95: ${formatDate(milestones.production.p95)}`);
      }
      const dates = lane.createDiv({ cls: "path-to-prod-epic-milestones" });
      for (const stage of STAGES) {
        const milestone = dates.createSpan();
        milestone.createSpan({ cls: `path-to-prod-legend-dot path-to-prod-stage-${stage}` });
        milestone.createSpan({ text: `${stageLabel(stage)} P80` });
        milestone.createEl("strong", { text: formatDate(milestones[stage].p80) });
      }
    }

    const foot = panel.createDiv({ cls: "path-to-prod-epic-foot" });
    foot.createSpan({ text: "Known unpointed tickets use similar historical Jira work. The reserve adds provisional tickets for work not yet created." });
    foot.createSpan({ text: "Each row assumes the full configured team capacity; dates are not a combined portfolio commitment." });

    const details = container.createDiv({ cls: "path-to-prod-epic-details" });
    for (const epic of ordered) {
      const section = details.createEl("details", { attr: { "data-epic-key": epic.epic.key } });
      const summary = section.createEl("summary");
      summary.createEl("strong", { text: `${epic.epic.key} · ${epic.epic.summary}` });
      summary.createSpan({ text: epic.forecast ? `P80 production ${formatDate(epic.forecast.milestones.production.p80)}` : "No remaining scope" });
      if (epic.forecast) {
        const dates = section.createDiv({ cls: "path-to-prod-epic-date-grid" });
        for (const stage of STAGES) {
          const tile = dates.createDiv();
          tile.createSpan({ cls: `path-to-prod-legend-dot path-to-prod-stage-${stage}` });
          tile.createEl("strong", { text: stageLabel(stage) });
          tile.createSpan({ text: `P50 ${shortDate(epic.forecast.milestones[stage].p50)} · P80 ${shortDate(epic.forecast.milestones[stage].p80)} · P95 ${shortDate(epic.forecast.milestones[stage].p95)}` });
        }
        section.createEl("p", { text: epic.forecast.warnings[0] ?? `${epic.remainingChildren} known tickets remain.` });
      }
      const children = this.epicGroups.find((group) => group.epic.key === epic.epic.key)?.children ?? [];
      if (children.length > 0) {
        const list = section.createEl("ul");
        for (const child of children) {
          const item = list.createEl("li");
          const mark = item.createEl("label", { cls: "path-to-prod-epic-ticket-mark" });
          const checkbox = mark.createEl("input", { type: "checkbox", attr: { "aria-label": `Mark ${child.key} important` } });
          checkbox.checked = this.plugin.settings.importantTicketKeys.includes(child.key);
          checkbox.addEventListener("change", () => this.updateImportantKey("importantTicketKeys", child.key, checkbox.checked, container));
          mark.createSpan({ text: "Mark important" });
          item.createSpan({ text: `${child.key} · ${child.summary} · ${child.status}` });
          if (isImportantIssue(child, this.plugin.settings) && !checkbox.checked) {
            item.createSpan({ cls: "path-to-prod-epic-auto-mark", text: "Jira priority / label" });
          }
        }
      }
    }
  }

  private refreshEpicForecast(container: HTMLElement): void {
    this.epicForecasts = this.plugin.reforecastEpics(this.epicGroups);
    this.rerenderEpicDashboard(container);
  }

  private rerenderEpicDashboard(container: HTMLElement): void {
    const scrollLeft = container.querySelector<HTMLElement>(".path-to-prod-epic-scroll")?.scrollLeft ?? 0;
    const openKeys = new Set(container.findAll(".path-to-prod-epic-details details[open]")
      .map((detail) => detail.getAttribute("data-epic-key")));
    this.render();
    const nextScroll = container.querySelector<HTMLElement>(".path-to-prod-epic-scroll");
    if (nextScroll) nextScroll.scrollLeft = scrollLeft;
    for (const detail of container.findAll(".path-to-prod-epic-details details")) {
      if (openKeys.has(detail.getAttribute("data-epic-key"))) detail.setAttribute("open", "");
    }
  }

  private updateImportantKey(
    setting: "importantEpicKeys" | "importantTicketKeys",
    key: string,
    checked: boolean,
    container: HTMLElement
  ): void {
    const values = new Set(this.plugin.settings[setting]);
    if (checked) values.add(key);
    else values.delete(key);
    this.plugin.settings[setting] = [...values];
    void this.plugin.savePluginData();
    this.rerenderEpicDashboard(container);
  }

  private currentEmailReport(): EmailReport {
    const project = this.plugin.settings.jiraProjectKey;
    return this.viewMode === "goal"
        ? buildEmailReport({
            mode: "goal",
            project,
            generatedAt: this.result?.generatedAt ?? new Date().toISOString(),
            ...(this.result ? { goal: this.result } : {})
          })
        : buildEmailReport({
            mode: "epics",
            project,
            generatedAt: new Date().toISOString(),
            ...(this.epicForecasts ? { epics: this.epicForecasts } : {}),
            alerts: importantWorkAlerts(
              this.epicGroups,
              this.epicForecasts ?? [],
              this.plugin.settings,
              todayLocalKey()
            )
          });
  }

  private async copyCurrentEmailReport(openDraft: boolean): Promise<void> {
    try {
      const report = this.currentEmailReport();
      const copy = copyEmailReport(report);
      if (openDraft) window.open(`mailto:?subject=${encodeURIComponent(report.subject)}`, "_blank");
      const format = await copy;
      new Notice(format === "rich"
        ? "Email report copied with colored stage dates. Paste it into the draft."
        : "Email report copied as plain text. Paste it into the draft.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not copy the email report.");
    }
  }

  private async forecastEpics(): Promise<void> {
    this.busy = true;
    this.status = "Loading epics and their Jira children…";
    this.render();
    try {
      const result = await this.plugin.runEpicForecast();
      this.epicGroups = result.groups;
      this.epicForecasts = result.forecasts;
      this.status = `Forecasted ${result.forecasts.length} epics using ${this.plugin.cache.history.length} historical issues.`;
    } catch (error) {
      this.status = error instanceof Error ? error.message : "Epic forecast failed.";
      new Notice(this.status);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private renderDeveloperDashboard(container: HTMLElement): void {
    if (!this.result) return;
    const workloads = this.result.developerWorkloads;
    const totalTickets = workloads.reduce(
      (total, workload) => total + workload.tickets.length,
      0
    );
    const unassignedTickets =
      workloads.find((workload) => workload.unassigned)?.tickets.length ?? 0;
    const assignedDevelopers = workloads.filter((workload) => !workload.unassigned).length;
    let selected = workloads.find(
      (workload) => workload.id === this.selectedDeveloperId
    );
    selected ??= workloads[0];
    this.selectedDeveloperId = selected?.id;

    const topbar = container.createDiv({ cls: "path-to-prod-drilldown-topbar" });
    const back = topbar.createEl("button", {
      cls: "path-to-prod-back",
      text: "← Delivery overview",
      attr: { type: "button" }
    });
    back.addEventListener("click", () => {
      this.activeDashboard = "overview";
      this.render();
    });
    topbar.createSpan({ text: "Development ownership" });

    const heading = container.createDiv({ cls: "path-to-prod-developer-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", { text: "Who is taking the tickets?" });
    headingCopy.createEl("p", {
      text: `${totalTickets} active development tickets grouped by current Jira assignee.`
    });
    heading.createSpan({
      cls: "path-to-prod-method",
      text: this.result.methodology === "scrum" ? "Current sprint" : "Current flow"
    });

    const stats = container.createDiv({ cls: "path-to-prod-developer-stats" });
    for (const [value, label] of [
      [assignedDevelopers, "Developers"],
      [totalTickets - unassignedTickets, "Assigned tickets"],
      [unassignedTickets, "Unassigned tickets"]
    ] as const) {
      const stat = stats.createDiv({ cls: "path-to-prod-developer-stat" });
      stat.createEl("strong", { text: String(value) });
      stat.createSpan({ text: label });
    }

    if (workloads.length === 0) {
      const empty = container.createDiv({ cls: "path-to-prod-empty" });
      empty.createEl("h2", { text: "No tickets are in development" });
      empty.createEl("p", {
        text: "Check the development status mapping or refresh the Jira goal data."
      });
      return;
    }

    const layout = container.createDiv({ cls: "path-to-prod-developer-layout" });
    const owners = layout.createDiv({ cls: "path-to-prod-owner-list" });
    const ownerHeader = owners.createDiv({ cls: "path-to-prod-owner-list-header" });
    ownerHeader.createEl("h3", { text: "Ticket owners" });
    ownerHeader.createSpan({ text: "Click a name to inspect work" });
    const maximumTickets = Math.max(...workloads.map((workload) => workload.tickets.length));
    for (const workload of workloads) {
      const owner = owners.createEl("button", {
        cls: `path-to-prod-owner${workload.id === selected?.id ? " is-selected" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": workload.id === selected?.id ? "true" : "false"
        }
      });
      owner.addEventListener("click", () => {
        this.selectedDeveloperId = workload.id;
        this.render();
      });
      owner.createSpan({
        cls: `path-to-prod-avatar${workload.unassigned ? " is-unassigned" : ""}`,
        text: workload.unassigned ? "?" : initials(workload.displayName)
      });
      const ownerCopy = owner.createSpan({ cls: "path-to-prod-owner-copy" });
      const ownerName = ownerCopy.createSpan({ cls: "path-to-prod-owner-name" });
      ownerName.createEl("strong", { text: workload.displayName });
      ownerName.createSpan({
        text: workload.throughput
          ? `${workload.tickets.length} current · ${workload.throughput.completedPerMonth}/mo`
          : `${workload.tickets.length} current`
      });
      const track = ownerCopy.createSpan({ cls: "path-to-prod-owner-track" });
      const fill = track.createSpan({ cls: "path-to-prod-owner-fill" });
      fill.style.width = `${Math.max(
        8,
        (workload.tickets.length / maximumTickets) * 100
      )}%`;
      owner.createSpan({
        cls: "path-to-prod-owner-share",
        text: `${Math.round((workload.tickets.length / totalTickets) * 100)}%`
      });
    }

    if (selected) this.renderDeveloperTickets(layout, selected, totalTickets);
  }

  private renderDeveloperTickets(
    container: HTMLElement,
    workload: DeveloperWorkload,
    totalTickets: number
  ): void {
    const detail = container.createDiv({ cls: "path-to-prod-ticket-detail" });
    const header = detail.createDiv({ cls: "path-to-prod-ticket-detail-header" });
    const identity = header.createDiv({ cls: "path-to-prod-ticket-identity" });
    identity.createSpan({
      cls: `path-to-prod-avatar path-to-prod-avatar-large${
        workload.unassigned ? " is-unassigned" : ""
      }`,
      text: workload.unassigned ? "?" : initials(workload.displayName)
    });
    const copy = identity.createDiv();
    copy.createEl("h3", { text: workload.displayName });
    copy.createEl("p", {
      text: `${workload.tickets.length} tickets · ${Math.round(
        (workload.tickets.length / totalTickets) * 100
      )}% of development work`
    });

    if (workload.throughput) {
      const context = detail.createDiv({ cls: "path-to-prod-throughput-context" });
      context.createSpan({
        cls: `path-to-prod-throughput-label is-${workload.throughput.classification}`,
        text: workload.throughput.classificationLabel
      });
      const metrics = context.createDiv({ cls: "path-to-prod-throughput-metrics" });
      for (const [value, label] of [
        [String(workload.throughput.completedCount), "completed in history"],
        [String(workload.throughput.completedPerMonth), "per active month"],
        [
          workload.throughput.medianDevelopmentDays === undefined
            ? "—"
            : String(workload.throughput.medianDevelopmentDays),
          "median development days"
        ]
      ] as const) {
        const metric = metrics.createDiv();
        metric.createEl("strong", { text: value });
        metric.createSpan({ text: label });
      }
      context.createEl("p", {
        text: workload.throughput.sufficientHistory
          ? "Context only: based on completed issues currently attributed to this Jira assignee."
          : "Fewer than 10 completed issues; no throughput comparison is applied."
      });
    }

    const tableWrap = detail.createDiv({ cls: "path-to-prod-ticket-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "path-to-prod-ticket-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Ticket", "Work", "Priority", "Status"]) {
      head.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const ticket of workload.tickets) {
      const row = body.createEl("tr");
      row.createEl("td", { text: ticket.key, cls: "path-to-prod-ticket-key" });
      const work = row.createEl("td");
      work.createEl("strong", { text: ticket.summary });
      work.createSpan({ text: ticket.issueType });
      row.createEl("td", { text: ticket.priority ?? "—" });
      const status = row.createEl("td");
      status.createSpan({ cls: "path-to-prod-ticket-status", text: ticket.status });
    }
  }

  private async sync(): Promise<void> {
    this.busy = true;
    this.status = "Reading completed Jira issues…";
    this.render();
    try {
      const counts = await this.plugin.syncData((completed, total) => {
        this.status = `Reading Jira transition history ${completed}/${total}…`;
        this.render();
      });
      this.status = `Synced ${counts.history} historical issues and ${counts.calendar} calendar entries.`;
      new Notice("Path to Prod data sync complete.");
    } catch (error) {
      this.status = error instanceof Error ? error.message : "History sync failed.";
      new Notice(this.status);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async forecast(): Promise<void> {
    this.busy = true;
    this.status = "Running delivery simulations…";
    this.render();
    try {
      this.result = await this.plugin.runForecast();
      this.status = `Forecast generated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(this.result.generatedAt))}.`;
    } catch (error) {
      this.status = error instanceof Error ? error.message : "Forecast failed.";
      new Notice(this.status);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

