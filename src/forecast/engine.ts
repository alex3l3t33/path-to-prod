import type { PathToProdSettings } from "../settings";
import type {
  AgilityMethod,
  DeveloperThroughput,
  DeveloperWorkload,
  ForecastResult,
  HistoricalIssue,
  Stage,
  StageMilestone,
  TicketFeatures
} from "../types";
import { STAGES } from "../types";
import { CapacityCalendar, addDays, parseDate, toDateKey } from "./calendar";
import { stageForStatus } from "./history";

export interface ForecastOptions {
  startDate?: string;
  seed?: number;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3)
  );
}

function overlapCount(left: string[], right: string[]): number {
  const rightValues = new Set(right.map((value) => value.toLocaleLowerCase()));
  return left.reduce(
    (count, value) => count + (rightValues.has(value.toLocaleLowerCase()) ? 1 : 0),
    0
  );
}

function similarity(
  target: TicketFeatures,
  candidate: HistoricalIssue,
  useAssigneeHistory: boolean
): number {
  let score = 0;
  if (target.issueType === candidate.issueType) score += 4;
  if (target.priority && target.priority === candidate.priority) score += 1;
  if (
    useAssigneeHistory &&
    target.assignee?.id &&
    target.assignee.id === candidate.assignee?.id
  ) {
    score += 2;
  }
  score += Math.min(4, overlapCount(target.components, candidate.components) * 2);
  score += Math.min(3, overlapCount(target.labels, candidate.labels));

  const targetTokens = tokens(target.summary);
  const candidateTokens = tokens(candidate.summary);
  const shared = [...targetTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...targetTokens, ...candidateTokens]).size;
  if (union > 0) score += (shared / union) * 5;
  return score;
}

function durationPool(
  target: TicketFeatures,
  history: HistoricalIssue[],
  stage: Stage,
  useAssigneeHistory: boolean
): Array<{ duration: number; weight: number }> {
  const ranked = history
    .filter((issue) => issue.stageDurations[stage] !== undefined)
    .map((issue) => ({
      duration: issue.stageDurations[stage] as number,
      weight: similarity(target, issue, useAssigneeHistory)
    }))
    .sort((left, right) => right.weight - left.weight);

  const similar = ranked.filter((entry) => entry.weight > 0).slice(0, 20);
  const selected = similar.length >= 5 ? similar : ranked;
  return selected.map((entry) => ({
    duration: entry.duration,
    weight: Math.max(0.25, entry.weight)
  }));
}

function weightedSample(
  pool: Array<{ duration: number; weight: number }>,
  fallback: number,
  random: () => number
): number {
  if (pool.length === 0) return fallback;
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * total;
  let selected = pool.at(-1)?.duration ?? fallback;
  for (const entry of pool) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      selected = entry.duration;
      break;
    }
  }
  const jitter = 0.85 + random() * 0.3;
  return Math.max(0.1, selected * jitter);
}

function stageIndex(stage: Stage | undefined): number {
  return stage ? STAGES.indexOf(stage) : 0;
}

function mondayOfWeek(value: string): string {
  const date = parseDate(value);
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return toDateKey(addDays(date, 1 - weekday));
}

function resolveMethodology(
  goalIssues: TicketFeatures[],
  history: HistoricalIssue[],
  settings: PathToProdSettings
): { methodology: AgilityMethod; reason: string } {
  if (settings.agilityMethod !== "auto") {
    return {
      methodology: settings.agilityMethod,
      reason: `Configured manually as ${settings.agilityMethod}.`
    };
  }
  const tickets = [...goalIssues, ...history];
  const sprintTickets = tickets.filter((issue) => issue.sprintNames.length > 0).length;
  const ratio = tickets.length === 0 ? 0 : sprintTickets / tickets.length;
  if (tickets.length >= 5 && ratio >= 0.5) {
    return {
      methodology: "scrum",
      reason: `${Math.round(ratio * 100)}% of sampled Jira issues have sprint assignments.`
    };
  }
  return {
    methodology: "kanban",
    reason:
      tickets.length < 5
        ? "Too little sprint metadata was available, so continuous flow was used."
        : `${Math.round(ratio * 100)}% of sampled Jira issues have sprint assignments.`
  };
}

function percentile(values: string[], probability: number): string {
  const sorted = [...values].sort();
  const index = Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1);
  return sorted[Math.max(0, index)] as string;
}

function milestonesFor(values: string[]): StageMilestone {
  return {
    p50: percentile(values, 0.5),
    p80: percentile(values, 0.8),
    p95: percentile(values, 0.95)
  };
}

function numericMedian(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) return undefined;
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1];
  return left === undefined ? right : (left + right) / 2;
}

function developerThroughput(
  history: HistoricalIssue[]
): Map<string, DeveloperThroughput> {
  const raw = new Map<
    string,
    { completedCount: number; resolvedDates: number[]; developmentDays: number[] }
  >();
  for (const issue of history) {
    if (!issue.assignee || !issue.resolvedAt) continue;
    const resolvedAt = Date.parse(issue.resolvedAt);
    if (!Number.isFinite(resolvedAt)) continue;
    const aggregate = raw.get(issue.assignee.id) ?? {
      completedCount: 0,
      resolvedDates: [],
      developmentDays: []
    };
    aggregate.completedCount += 1;
    aggregate.resolvedDates.push(resolvedAt);
    const developmentDays = issue.stageDurations.development;
    if (developmentDays !== undefined) aggregate.developmentDays.push(developmentDays);
    raw.set(issue.assignee.id, aggregate);
  }

  const computed = [...raw.entries()].map(([id, aggregate]) => {
    const dates = [...aggregate.resolvedDates].sort((left, right) => left - right);
    const first = dates[0] as number;
    const last = dates.at(-1) as number;
    const activeMonths = Math.max(1, (last - first) / 2_629_746_000 + 1);
    return { id, aggregate, rate: aggregate.completedCount / activeMonths };
  });
  const eligibleRates = computed
    .filter((entry) => entry.aggregate.completedCount >= 10)
    .map((entry) => entry.rate);
  const teamMedian = numericMedian(eligibleRates) ?? 0;
  const highestRate = eligibleRates.length > 1 ? Math.max(...eligibleRates) : undefined;

  return new Map(
    computed.map(({ id, aggregate, rate }) => {
      const sufficientHistory = aggregate.completedCount >= 10;
      let classification: DeveloperThroughput["classification"] = "limited-history";
      let classificationLabel = "Limited history";
      if (sufficientHistory) {
        if (highestRate !== undefined && rate === highestRate) {
          classification = "highest-observed";
          classificationLabel = "Highest observed throughput";
        } else if (teamMedian > 0 && rate >= teamMedian * 1.2) {
          classification = "above-team-median";
          classificationLabel = "Above team median";
        } else {
          classification = "team-range";
          classificationLabel = "Within team range";
        }
      }
      const medianDevelopmentDays = numericMedian(aggregate.developmentDays);
      return [
        id,
        {
          completedCount: aggregate.completedCount,
          completedPerMonth: Math.round(rate * 10) / 10,
          ...(medianDevelopmentDays === undefined
            ? {}
            : { medianDevelopmentDays: Math.round(medianDevelopmentDays * 10) / 10 }),
          classification,
          classificationLabel,
          sufficientHistory
        }
      ];
    })
  );
}

function buildDeveloperWorkloads(
  goalIssues: TicketFeatures[],
  statusStages: Map<string, Stage | undefined>,
  history: HistoricalIssue[],
  useAssigneeHistory: boolean
): DeveloperWorkload[] {
  const workloads = new Map<string, DeveloperWorkload>();
  const throughput = useAssigneeHistory
    ? developerThroughput(history)
    : new Map<string, DeveloperThroughput>();
  for (const issue of goalIssues) {
    if (statusStages.get(issue.key) !== "development") continue;
    const id = issue.assignee?.id ?? "__unassigned__";
    let workload = workloads.get(id);
    if (!workload) {
      const historyContext = throughput.get(id);
      workload = {
        id,
        displayName: issue.assignee?.displayName ?? "Unassigned",
        unassigned: !issue.assignee,
        tickets: [],
        ...(historyContext ? { throughput: historyContext } : {})
      };
    }
    workload.tickets.push({
      key: issue.key,
      summary: issue.summary,
      issueType: issue.issueType,
      ...(issue.priority ? { priority: issue.priority } : {}),
      status: issue.status
    });
    workloads.set(id, workload);
  }
  return [...workloads.values()]
    .map((workload) => ({
      ...workload,
      tickets: [...workload.tickets].sort((left, right) =>
        left.key.localeCompare(right.key, undefined, { numeric: true })
      )
    }))
    .sort(
      (left, right) =>
        Number(left.unassigned) - Number(right.unassigned) ||
        right.tickets.length - left.tickets.length ||
        left.displayName.localeCompare(right.displayName)
    );
}

export function forecastGoal(
  goalIssues: TicketFeatures[],
  history: HistoricalIssue[],
  settings: PathToProdSettings,
  options: ForecastOptions = {}
): ForecastResult {
  if (goalIssues.length === 0) throw new Error("The goal JQL returned no issues.");
  const startDate = options.startDate ?? new Date().toISOString().slice(0, 10);
  const start = parseDate(startDate);
  const seed =
    options.seed ?? hashString(`${startDate}:${goalIssues.map((issue) => issue.key).join(",")}`);
  const random = mulberry32(seed);
  const simulations = Math.max(100, Math.round(settings.simulations));
  const calendar = new CapacityCalendar({
    teamSize: settings.teamSize,
    focusFactor: settings.focusFactor,
    holidays: settings.holidays,
    leave: settings.leave
  });
  const method = resolveMethodology(goalIssues, history, settings);
  const sprintAnchor = settings.sprintAnchorDate || mondayOfWeek(startDate);
  const results: Record<Stage, string[]> = {
    development: [],
    staging: [],
    production: []
  };
  const statusStages = new Map(
    goalIssues.map((issue) => [
      issue.key,
      stageForStatus(issue.status, settings.stageStatuses)
    ])
  );

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    let cursor = new Date(start);
    for (const stage of STAGES) {
      const currentStageIndex = STAGES.indexOf(stage);
      const stageIssues = goalIssues.filter(
        (issue) => stageIndex(statusStages.get(issue.key)) <= currentStageIndex
      );
      const effort = stageIssues.reduce((sum, issue) => {
        const pool = durationPool(
          issue,
          history,
          stage,
          settings.useAssigneeHistory
        );
        return sum + weightedSample(pool, settings.fallbackDays[stage], random);
      }, 0);

      cursor = calendar.finishWork(cursor, effort, settings.stageCapacity[stage]);
      if (method.methodology === "scrum" && stage === "development") {
        cursor = calendar.sprintEndOnOrAfter(
          cursor,
          sprintAnchor,
          settings.sprintLengthWeeks
        );
      }
      if (stage === "production") {
        if (method.methodology === "scrum" && settings.scrumReleaseAtSprintEnd) {
          cursor = calendar.sprintEndOnOrAfter(
            cursor,
            sprintAnchor,
            settings.sprintLengthWeeks
          );
        }
        cursor = calendar.nextReleaseDay(cursor, settings.releaseWeekdays);
      }
      results[stage].push(toDateKey(cursor));
      if (stage !== "production") cursor = calendar.nextWorkday(cursor);
    }
  }

  const warnings: string[] = [];
  const sampleCounts = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      history.filter((issue) => issue.stageDurations[stage] !== undefined).length
    ])
  ) as Record<Stage, number>;
  for (const stage of STAGES) {
    const sampleCount = sampleCounts[stage];
    if (sampleCount < 10) {
      warnings.push(
        `${stage} has only ${sampleCount} historical samples; fallback assumptions materially affect the forecast.`
      );
    }
  }
  const unmapped = goalIssues.filter((issue) => !statusStages.get(issue.key));
  if (unmapped.length > 0) {
    warnings.push(
      `${unmapped.length} goal issue(s) have unmapped statuses and were treated as not yet started.`
    );
  }

  const currentStageCounts: Record<Stage | "unmapped", number> = {
    development: 0,
    staging: 0,
    production: 0,
    unmapped: 0
  };
  for (const issue of goalIssues) {
    const stage = statusStages.get(issue.key);
    currentStageCounts[stage ?? "unmapped"] += 1;
  }
  const minimumSamples = Math.min(...Object.values(sampleCounts));
  const dataConfidence =
    minimumSamples >= 30 ? "high" : minimumSamples >= 10 ? "medium" : "low";
  const developerWorkloads = buildDeveloperWorkloads(
    goalIssues,
    statusStages,
    history,
    settings.useAssigneeHistory
  );

  return {
    generatedAt: new Date().toISOString(),
    issueCount: goalIssues.length,
    historicalIssueCount: history.length,
    methodology: method.methodology,
    methodologyReason: method.reason,
    sprintLengthWeeks: settings.sprintLengthWeeks,
    dataConfidence,
    sampleCounts,
    currentStageCounts,
    holidayCount: settings.holidays.length,
    leavePeriodCount: settings.leave.length,
    developerWorkloads,
    milestones: {
      development: milestonesFor(results.development),
      staging: milestonesFor(results.staging),
      production: milestonesFor(results.production)
    },
    warnings
  };
}

