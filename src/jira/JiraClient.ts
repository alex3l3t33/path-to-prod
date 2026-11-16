import { requestUrl } from "obsidian";
import type { PathToProdSettings } from "../settings";
import type { StatusChange, TicketFeatures } from "../types";
import { buildJiraAuthorization } from "./auth";

interface JiraSearchIssue {
  id: string;
  key: string;
  fields: {
    [key: string]: unknown;
    summary?: string;
    issuetype?: { name?: string };
    priority?: { name?: string };
    labels?: string[];
    components?: Array<{ name?: string }>;
    status?: { name?: string };
    assignee?: { accountId?: string; displayName?: string } | null;
    created?: string;
    resolutiondate?: string | null;
  };
}

interface SearchResponse {
  issues?: JiraSearchIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

interface ChangelogResponse {
  values?: Array<{
    created?: string;
    items?: Array<{
      field?: string;
      fieldId?: string;
      fromString?: string | null;
      toString?: string | null;
    }>;
  }>;
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
}

interface JiraFieldSearchResponse {
  values?: Array<{
    id?: string;
    name?: string;
    schema?: { custom?: string };
  }>;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function bodySummary(value: string): string {
  const plainText = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plainText.slice(0, 240);
}

function authHelp(email: string): string {
  return email.trim()
    ? "The plugin used Basic authentication. Verify the Atlassian email and API token."
    : "The plugin used Bearer authentication. For an Atlassian Cloud API token, add the Atlassian account email; leave email blank only for a Bearer or personal access token.";
}

export class JiraClient {
  private sprintFieldId: string | null | undefined;

  constructor(private readonly settings: PathToProdSettings) {}

  private get baseUrl(): string {
    const baseUrl = normalizeBaseUrl(this.settings.jiraBaseUrl);
    if (!baseUrl || !this.settings.jiraApiToken.trim()) {
      throw new Error("Complete the Jira site URL and API or Bearer token in Path to Prod settings.");
    }
    return baseUrl;
  }

  private get headers(): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: buildJiraAuthorization(
        this.settings.jiraEmail,
        this.settings.jiraApiToken
      ),
      "Content-Type": "application/json"
    };
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await requestUrl({
      url,
      method: options.method ?? "GET",
      headers: this.headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      throw: false
    });
    const isHtml = /^\s*(?:<!doctype\s+html|<html\b)/i.test(response.text);
    if (response.status < 200 || response.status >= 300) {
      const summary = bodySummary(response.text);
      throw new Error(
        `Jira returned HTTP ${response.status} for ${url}. ${summary || "No response body."} ${authHelp(this.settings.jiraEmail)}`
      );
    }
    if (isHtml) {
      throw new Error(
        `Jira returned an HTML page instead of JSON for ${url}. The Jira site URL may point to a login or proxy page. Use the Jira origin, such as https://company.atlassian.net. ${authHelp(this.settings.jiraEmail)}`
      );
    }
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new Error(
        `Jira returned a non-JSON response for ${url}. Check the Jira site URL and authentication method. ${authHelp(this.settings.jiraEmail)}`
      );
    }
  }

  async testConnection(): Promise<string> {
    const user = await this.request<{ displayName?: string; emailAddress?: string }>(
      "/rest/api/3/myself"
    );
    return user.displayName ?? user.emailAddress ?? "unknown user";
  }

  private async findSprintFieldId(): Promise<string | undefined> {
    if (this.sprintFieldId !== undefined) return this.sprintFieldId ?? undefined;
    try {
      const response = await this.request<JiraFieldSearchResponse>(
        "/rest/api/3/field/search?query=Sprint&maxResults=50"
      );
      const sprintField = response.values?.find(
        (field) =>
          field.name?.toLocaleLowerCase() === "sprint" ||
          field.schema?.custom?.includes("gh-sprint")
      );
      this.sprintFieldId = sprintField?.id ?? null;
    } catch {
      this.sprintFieldId = null;
    }
    return this.sprintFieldId ?? undefined;
  }

  private sprintNames(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (typeof entry === "object" && entry !== null && "name" in entry) {
          const name = (entry as { name?: unknown }).name;
          return typeof name === "string" ? name : undefined;
        }
        if (typeof entry === "string") {
          const legacyName = /name=([^,\]]+)/.exec(entry)?.[1];
          return legacyName ?? entry;
        }
        return undefined;
      })
      .filter((name): name is string => Boolean(name));
  }

  private resolveJql(value: string): string {
    if (!value.includes("{{project}}")) return value;
    const project = this.settings.jiraProjectKey.trim();
    if (!project) {
      throw new Error(
        "Set the company Jira project key or remove {{project}} from the JQL query."
      );
    }
    const escapedProject = project.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return value.replaceAll("{{project}}", escapedProject);
  }

  async searchIssues(jql: string, limit: number): Promise<TicketFeatures[]> {
    if (!jql.trim()) throw new Error("The Jira JQL query is empty.");
    const resolvedJql = this.resolveJql(jql);
    const result: TicketFeatures[] = [];
    let nextPageToken: string | undefined;
    const sprintFieldId = await this.findSprintFieldId();

    do {
      const pageSize = Math.min(100, limit - result.length);
      const response = await this.request<SearchResponse>("/rest/api/3/search/jql", {
        method: "POST",
        body: {
          jql: resolvedJql,
          maxResults: pageSize,
          fields: [
            "summary",
            "issuetype",
            "priority",
            "labels",
            "components",
            "status",
            "assignee",
            "created",
            "resolutiondate",
            ...(sprintFieldId ? [sprintFieldId] : [])
          ],
          ...(nextPageToken ? { nextPageToken } : {})
        }
      });

      for (const issue of response.issues ?? []) {
        result.push({
          id: issue.id,
          key: issue.key,
          summary: issue.fields.summary ?? issue.key,
          issueType: issue.fields.issuetype?.name ?? "Unknown",
          ...(issue.fields.priority?.name
            ? { priority: issue.fields.priority.name }
            : {}),
          labels: issue.fields.labels ?? [],
          components: (issue.fields.components ?? [])
            .map((component) => component.name)
            .filter((name): name is string => Boolean(name)),
          status: issue.fields.status?.name ?? "Unknown",
          createdAt: issue.fields.created ?? new Date().toISOString(),
          sprintNames: sprintFieldId
            ? this.sprintNames(issue.fields[sprintFieldId])
            : [],
          ...(issue.fields.assignee?.displayName
            ? {
                assignee: {
                  id:
                    issue.fields.assignee.accountId ??
                    issue.fields.assignee.displayName,
                  displayName: issue.fields.assignee.displayName
                }
              }
            : {}),
          ...(issue.fields.resolutiondate
            ? { resolvedAt: issue.fields.resolutiondate }
            : {})
        });
        if (result.length >= limit) break;
      }

      nextPageToken = response.nextPageToken;
      if (response.isLast || !nextPageToken || result.length >= limit) break;
    } while (result.length < limit);

    return result;
  }

  async getIssueStatusChanges(issueKey: string): Promise<StatusChange[]> {
    const result: StatusChange[] = [];
    let startAt = 0;

    while (true) {
      const response = await this.request<ChangelogResponse>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?startAt=${startAt}&maxResults=100`
      );
      const values = response.values ?? [];
      for (const history of values) {
        if (!history.created) continue;
        for (const item of history.items ?? []) {
          if (
            item.field?.toLowerCase() !== "status" &&
            item.fieldId?.toLowerCase() !== "status"
          ) {
            continue;
          }
          if (!item.fromString || !item.toString) continue;
          result.push({
            createdAt: history.created,
            fromStatus: item.fromString,
            toStatus: item.toString
          });
        }
      }

      const pageSize = response.maxResults ?? values.length;
      startAt += pageSize;
      if (response.isLast || values.length === 0 || startAt >= (response.total ?? 0)) break;
    }

    return result.sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
    );
  }

  async getStatusChanges(
    issues: TicketFeatures[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, StatusChange[]>> {
    const result = new Map<string, StatusChange[]>();
    const concurrency = 5;
    let completed = 0;

    for (let offset = 0; offset < issues.length; offset += concurrency) {
      const batch = issues.slice(offset, offset + concurrency);
      const values = await Promise.all(
        batch.map(async (issue) => [issue.key, await this.getIssueStatusChanges(issue.key)] as const)
      );
      for (const [key, changes] of values) {
        result.set(key, changes);
        completed += 1;
        onProgress?.(completed, issues.length);
      }
    }

    return result;
  }
}

