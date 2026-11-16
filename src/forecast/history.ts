import type { PathToProdSettings } from "../settings";
import type {
  HistoricalIssue,
  Stage,
  StatusChange,
  TicketFeatures
} from "../types";
import { STAGES } from "../types";

const DAY_MS = 86_400_000;

function normalizeStatus(status: string): string {
  return status.trim().toLocaleLowerCase();
}

export function stageForStatus(
  status: string,
  stageStatuses: Record<Stage, string[]>
): Stage | undefined {
  const normalized = normalizeStatus(status);
  return STAGES.find((stage) =>
    stageStatuses[stage].some((candidate) => normalizeStatus(candidate) === normalized)
  );
}

export function businessDaysBetween(startValue: string, endValue: string): number {
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  let total = 0;
  let cursor = start;
  while (cursor < end) {
    const current = new Date(cursor);
    const dayStart = Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate()
    );
    const dayEnd = dayStart + DAY_MS;
    const overlapEnd = Math.min(dayEnd, end);
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      total += (overlapEnd - cursor) / DAY_MS;
    }
    cursor = overlapEnd;
  }
  return total;
}

export function buildHistoricalIssue(
  issue: TicketFeatures,
  changes: StatusChange[],
  settings: Pick<PathToProdSettings, "stageStatuses">
): HistoricalIssue | undefined {
  if (changes.length === 0) return undefined;
  const stageDurations: Partial<Record<Stage, number>> = {};
  let currentStatus = changes[0]?.fromStatus ?? issue.status;
  let cursor = issue.createdAt;

  for (const change of changes) {
    const stage = stageForStatus(currentStatus, settings.stageStatuses);
    if (stage) {
      stageDurations[stage] =
        (stageDurations[stage] ?? 0) + businessDaysBetween(cursor, change.createdAt);
    }
    currentStatus = change.toStatus;
    cursor = change.createdAt;
  }

  if (issue.resolvedAt) {
    const finalStage = stageForStatus(currentStatus, settings.stageStatuses);
    if (finalStage) {
      stageDurations[finalStage] =
        (stageDurations[finalStage] ?? 0) +
        businessDaysBetween(cursor, issue.resolvedAt);
    }
  }

  for (const stage of STAGES) {
    const duration = stageDurations[stage];
    if (duration !== undefined && duration < 0.05) delete stageDurations[stage];
  }
  if (Object.keys(stageDurations).length === 0) return undefined;

  return { ...issue, stageDurations };
}

export function buildHistoricalIssues(
  issues: TicketFeatures[],
  changesByIssue: Map<string, StatusChange[]>,
  settings: Pick<PathToProdSettings, "stageStatuses">
): HistoricalIssue[] {
  return issues
    .map((issue) =>
      buildHistoricalIssue(issue, changesByIssue.get(issue.key) ?? [], settings)
    )
    .filter((issue): issue is HistoricalIssue => issue !== undefined);
}

