import type { PathToProdSettings } from "../settings";
import type { EpicForecast, EpicGroup, ImportantWorkAlert, TicketFeatures } from "../types";
import { addDays, CapacityCalendar, parseDate, toDateKey } from "./calendar";
import { isCompletedIssue } from "./epics";

function normalized(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
}

export function isImportantIssue(issue: TicketFeatures, settings: PathToProdSettings): boolean {
  if (settings.importantEpicKeys.includes(issue.key) || settings.importantTicketKeys.includes(issue.key)) {
    return true;
  }
  const priorities = normalized(settings.importantPriorities);
  const labels = normalized(settings.importantLabels);
  return Boolean(issue.priority && priorities.has(issue.priority.toLocaleLowerCase())) ||
    issue.labels.some((label) => labels.has(label.toLocaleLowerCase()));
}

function sprintTarget(startDate: string, settings: PathToProdSettings): string {
  const start = parseDate(startDate);
  const weekday = start.getUTCDay() || 7;
  const anchor = settings.sprintAnchorDate || toDateKey(addDays(start, 1 - weekday));
  const calendar = new CapacityCalendar({
    teamSize: settings.teamSize,
    focusFactor: settings.focusFactor,
    holidays: settings.holidays,
    leave: settings.leave
  });
  const sprintEnd = calendar.sprintEndOnOrAfter(start, anchor, settings.sprintLengthWeeks);
  const extraSprints = Math.max(0, Math.round(settings.importantTargetSprints) - 1);
  return toDateKey(calendar.sprintEndOnOrAfter(
    addDays(sprintEnd, extraSprints * settings.sprintLengthWeeks * 7),
    anchor,
    settings.sprintLengthWeeks
  ));
}

export function importantWorkAlerts(
  groups: EpicGroup[],
  forecasts: EpicForecast[],
  settings: PathToProdSettings,
  startDate = new Date().toISOString().slice(0, 10)
): ImportantWorkAlert[] {
  const forecastByKey = new Map(forecasts.map((item) => [item.epic.key, item]));
  const alerts: ImportantWorkAlert[] = [];
  for (const group of groups) {
    const epicMarkedImportant = isImportantIssue(group.epic, settings);
    const importantChildren = group.children.filter((child) =>
      !isCompletedIssue(child, settings) && isImportantIssue(child, settings)
    );
    if (!epicMarkedImportant && importantChildren.length === 0) continue;
    const forecast = forecastByKey.get(group.epic.key)?.forecast;
    const dueDates = [
      ...(epicMarkedImportant && group.epic.dueDate ? [group.epic.dueDate] : []),
      ...importantChildren.flatMap((child) => child.dueDate ? [child.dueDate] : [])
    ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
    const dueDate = dueDates.sort()[0];
    const targetDate = dueDate ?? (forecast?.methodology === "scrum" ? sprintTarget(startDate, settings) : undefined);
    const base = {
      epicKey: group.epic.key,
      epicSummary: group.epic.summary,
      importantTicketKeys: importantChildren.map((child) => child.key),
      epicMarkedImportant
    };
    if (!forecast) {
      alerts.push({ ...base, ...(targetDate ? { targetDate } : {}), targetSource: dueDate ? "due-date" : "missing-target", state: "needs-estimate" });
      continue;
    }
    const forecastDate = forecast.milestones.production.p80;
    if (!targetDate) {
      alerts.push({ ...base, forecastDate, targetSource: "missing-target", state: "needs-target" });
    } else if (forecastDate > targetDate) {
      alerts.push({ ...base, forecastDate, targetDate, targetSource: dueDate ? "due-date" : "sprint", state: "risk" });
    }
  }
  return alerts.sort((left, right) => {
    const rank = { risk: 0, "needs-estimate": 1, "needs-target": 2 };
    return rank[left.state] - rank[right.state] || left.epicKey.localeCompare(right.epicKey);
  });
}
