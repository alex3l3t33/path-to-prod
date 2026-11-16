export const STAGES = ["development", "staging", "production"] as const;

export type Stage = (typeof STAGES)[number];

export type AgilityMethod = "scrum" | "kanban";
export type AgilityMethodSetting = "auto" | AgilityMethod;

export interface TicketAssignee {
  id: string;
  displayName: string;
}

export interface TicketFeatures {
  id: string;
  key: string;
  summary: string;
  issueType: string;
  priority?: string;
  labels: string[];
  components: string[];
  status: string;
  createdAt: string;
  resolvedAt?: string;
  sprintNames: string[];
  assignee?: TicketAssignee;
}

export interface StatusChange {
  createdAt: string;
  fromStatus: string;
  toStatus: string;
}

export interface HistoricalIssue extends TicketFeatures {
  stageDurations: Partial<Record<Stage, number>>;
}

export interface LeavePeriod {
  person: string;
  start: string;
  end: string;
}

export interface CrewCalendarFeed {
  person: string;
  url: string;
}

export interface StageMilestone {
  p50: string;
  p80: string;
  p95: string;
}

export interface DeveloperTicket {
  key: string;
  summary: string;
  issueType: string;
  priority?: string;
  status: string;
}

export type ThroughputClassification =
  | "highest-observed"
  | "above-team-median"
  | "team-range"
  | "limited-history";

export interface DeveloperThroughput {
  completedCount: number;
  completedPerMonth: number;
  medianDevelopmentDays?: number;
  classification: ThroughputClassification;
  classificationLabel: string;
  sufficientHistory: boolean;
}

export interface DeveloperWorkload {
  id: string;
  displayName: string;
  unassigned: boolean;
  tickets: DeveloperTicket[];
  throughput?: DeveloperThroughput;
}

export interface ForecastResult {
  generatedAt: string;
  issueCount: number;
  historicalIssueCount: number;
  methodology: AgilityMethod;
  methodologyReason: string;
  sprintLengthWeeks: number;
  dataConfidence: "low" | "medium" | "high";
  sampleCounts: Record<Stage, number>;
  currentStageCounts: Record<Stage | "unmapped", number>;
  holidayCount: number;
  leavePeriodCount: number;
  developerWorkloads: DeveloperWorkload[];
  milestones: Record<Stage, StageMilestone>;
  warnings: string[];
}

