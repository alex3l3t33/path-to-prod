import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type PathToProdPlugin from "../main";
import type { DeveloperWorkload, ForecastResult, Stage } from "../types";
import { STAGES } from "../types";

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

export class ForecastView extends ItemView {
  private result?: ForecastResult;
  private busy = false;
  private status = "Configure Jira, then sync historical tickets.";
  private activeDashboard: "overview" | "developers" = "overview";
  private selectedDeveloperId: string | undefined;

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
    const syncButton = actions.createEl("button", { text: "Sync data" });
    syncButton.disabled = this.busy;
    syncButton.addEventListener("click", () => void this.sync());
    const forecastButton = actions.createEl("button", {
      text: "Run forecast",
      cls: "mod-cta"
    });
    forecastButton.disabled = this.busy;
    forecastButton.addEventListener("click", () => void this.forecast());

    container.createDiv({ cls: "path-to-prod-status", text: this.status });

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

