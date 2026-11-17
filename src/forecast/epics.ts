import type { PathToProdSettings } from "../settings";
import type { EpicForecast, EpicGroup, HistoricalIssue, TicketFeatures } from "../types";
import { forecastGoal, type ForecastOptions } from "./engine";

export function isCompletedIssue(issue: TicketFeatures, settings: PathToProdSettings): boolean {
  if (issue.statusCategory) return issue.statusCategory.toLowerCase() === "done";
  return Boolean(issue.resolvedAt) || settings.doneStatuses.some(
    (status) => status.toLowerCase() === issue.status.toLowerCase()
  );
}

export function forecastEpics(
  groups: EpicGroup[],
  history: HistoricalIssue[],
  settings: PathToProdSettings,
  options: ForecastOptions = {}
): EpicForecast[] {
  return groups.map(({ epic, children }) => {
    const remaining = children.filter((child) => !isCompletedIssue(child, settings));
    const configured = settings.epicReserveOverrides[epic.key];
    const reserveTickets = Math.min(
      50,
      Math.max(0, Math.round(configured ?? settings.unrefinedTicketsPerEpic))
    );
    const placeholders: TicketFeatures[] = Array.from({ length: reserveTickets }, (_, index) => ({
      id: `reserve:${epic.key}:${index}`,
      key: `${epic.key}-reserve-${index + 1}`,
      summary: epic.summary,
      issueType: "Story",
      ...(epic.priority ? { priority: epic.priority } : {}),
      labels: epic.labels,
      components: epic.components,
      status: "To Do",
      createdAt: epic.createdAt,
      sprintNames: []
    }));
    const scope = [...remaining, ...placeholders];
    const base = {
      epic,
      totalChildren: children.length,
      completedChildren: children.length - remaining.length,
      remainingChildren: remaining.length,
      reserveTickets
    };
    if (scope.length === 0) return base;

    const forecast = forecastGoal(scope, history, settings, options);
    if (reserveTickets > 0) {
      forecast.warnings = [
        `${reserveTickets} provisional ticket${reserveTickets === 1 ? "" : "s"} added for unrefined scope. Edit the reserve as the epic is refined.`,
        ...forecast.warnings.filter((warning) => !warning.includes("unmapped statuses"))
      ];
      if (children.length === 0 || reserveTickets >= remaining.length) {
        forecast.dataConfidence = "low";
      } else if (forecast.dataConfidence === "high") {
        forecast.dataConfidence = "medium";
      }
    }
    return { ...base, forecast };
  });
}
