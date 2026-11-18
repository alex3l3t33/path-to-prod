import { requestUrl } from "obsidian";
import type { PathToProdSettings } from "../settings";
import type { EpicGroup, StatusChange, TicketFeatures } from "../types";
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
    status?: { name?: string; statusCategory?: { key?: string } };
    parent?: { key?: string };
    assignee?: { accountId?: string; displayName?: string } | null;
    created?: string;
    resolutiondate?: string | null;
    duedate?: string | null;
  };
}

interface SearchResponse {
  issues?: JiraSearchIssue[];
  nextPageToken?: string;
  isLast?: boolean;
  startAt?: number;
  total?: number;
}

interface StatusHistory {
  created?: string;
  items?: Array<{
    field?: string;
    fieldId?: string;
    fromString?: string | null;
    toString?: string | null;
  }>;
}

interface ChangelogResponse {
  values?: StatusHistory[];
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

interface DataCenterIssueResponse {
  changelog?: { histories?: StatusHistory[]; total?: number };
}

export interface JiraConnectionResult {
  project: string;
  sampleIssueKey?: string;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a complete Jira URL, such as https://company.atlassian.net.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Use an HTTPS Jira API base URL without credentials, query parameters, or a fragment.");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (/\/(?:browse|projects|plugins\/servlet|jira\/software)(?:\/|$)/i.test(path)) {
    throw new Error("Use the company-approved Jira API base URL, not a board, issue, or project page.");
  }
  return `${parsed.origin}${path === "/" ? "" : path}`;
}

function authHelp(email: string): string {
  return email.trim()
    ? "The plugin used Basic authentication. Verify the Atlassian email and API token."
    : "The plugin used Bearer authentication. For an Atlassian Cloud API token, add the Atlassian account email; leave email blank only for a Bearer or personal access token.";
}

export class JiraClient {
  private sprintFieldId: string | null | undefined;
  private epicLinkFieldId: string | null | undefined;

  private get deployment(): "cloud" | "data-center" {
    if (this.settings.jiraDeployment !== "auto") return this.settings.jiraDeployment;
    const hostname = new URL(this.baseUrl).hostname;
    return hostname === "api.atlassian.com" || hostname.endsWith(".atlassian.net")
      ? "cloud"
      : "data-center";
  }

  private get apiRoot(): string {
    return this.deployment === "cloud" ? "/rest/api/3" : "/rest/api/2";
  }

  constructor(private readonly settings: PathToProdSettings) {}

  private get baseUrl(): string {
    const baseUrl = normalizeBaseUrl(this.settings.jiraBaseUrl);
    if (!baseUrl || !this.settings.jiraApiToken.trim()) {
      throw new Error("Complete the Jira site URL and select a Jira token secret in Path to Prod settings.");
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
    let response;
    try {
      response = await requestUrl({
        url,
        method: options.method ?? "GET",
        headers: this.headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        throw: false
      });
    } catch {
      throw new Error(`Could not reach Jira at ${this.baseUrl}. Check the company proxy, VPN, TLS certificate, and Jira allowlist with your administrator. The plugin does not send credentials through a separate proxy service.`);
    }
    const isHtml = /^\s*(?:<!doctype\s+html|<html\b)/i.test(response.text);
    if (response.status === 407) {
      throw new Error("The company proxy requires authentication (HTTP 407). Configure proxy access for Obsidian with your administrator; do not enter proxy credentials as the Jira token.");
    }
    if (isHtml) {
      throw new Error(`Jira returned an HTML page instead of JSON (HTTP ${response.status}). A corporate proxy, SSO gateway, or login page may be intercepting the request. Check the approved Jira API endpoint and proxy access.`);
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = response.status === 400
        ? "Jira rejected the request. Check the project name and JQL."
        : response.status === 403
          ? "This token may lack permission to browse the project or read issues and changelogs."
          : "Check API access and the company network policy.";
      throw new Error(
        `Jira returned HTTP ${response.status}. ${detail} ${response.status === 401 ? authHelp(this.settings.jiraEmail) : ""}`.trim()
      );
    }
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new Error(
        `Jira returned a non-JSON response. Check the Jira API endpoint, authentication method, and company proxy. ${authHelp(this.settings.jiraEmail)}`
      );
    }
  }

  async testConnection(): Promise<JiraConnectionResult> {
    const configuredProject = this.settings.jiraProjectKey.trim();
    if (!configuredProject) throw new Error("Set the company Jira project key or exact name before testing the connection.");
    const escapedProject = configuredProject.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const sample = await this.request<SearchResponse>(
      this.deployment === "cloud" ? `${this.apiRoot}/search/jql` : `${this.apiRoot}/search`, {
      method: "POST",
      body: {
        jql: `project = "${escapedProject}" ORDER BY updated DESC`,
        maxResults: 1,
        fields: ["summary"]
      }
    });
    if (sample.issues?.[0]?.key) {
      await this.getIssueStatusChanges(sample.issues[0].key);
    }
    return {
      project: configuredProject,
      ...(sample.issues?.[0]?.key ? { sampleIssueKey: sample.issues[0].key } : {})
    };
  }

  private async findSprintFieldId(): Promise<string | undefined> {
    if (this.sprintFieldId !== undefined) return this.sprintFieldId ?? undefined;
    try {
      const fields = this.deployment === "cloud"
        ? (await this.request<JiraFieldSearchResponse>(`${this.apiRoot}/field/search?query=Sprint&maxResults=50`)).values ?? []
        : await this.request<NonNullable<JiraFieldSearchResponse["values"]>>(`${this.apiRoot}/field`);
      const sprintField = fields.find(
        (field) =>
          field.name?.toLocaleLowerCase() === "sprint" ||
          field.schema?.custom?.includes("gh-sprint")
      );
      this.sprintFieldId = sprintField?.id ?? null;
      if (this.deployment === "data-center") {
        this.epicLinkFieldId = fields.find((field) => field.name?.toLocaleLowerCase() === "epic link")?.id ?? null;
      }
    } catch {
      this.sprintFieldId = null;
      if (this.deployment === "data-center") this.epicLinkFieldId = null;
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
    return value
      .replaceAll('"{{project}}"', `"${escapedProject}"`)
      .replaceAll("'{{project}}'", `"${escapedProject}"`)
      .replaceAll("{{project}}", `"${escapedProject}"`);
  }

  async searchIssues(jql: string, limit: number): Promise<TicketFeatures[]> {
    if (!jql.trim()) throw new Error("The Jira JQL query is empty.");
    const resolvedJql = this.resolveJql(jql);
    const result: TicketFeatures[] = [];
    let nextPageToken: string | undefined;
    let startAt = 0;
    const sprintFieldId = await this.findSprintFieldId();

    do {
      const pageSize = Math.min(100, limit - result.length);
      const response = await this.request<SearchResponse>(
        this.deployment === "cloud" ? `${this.apiRoot}/search/jql` : `${this.apiRoot}/search`, {
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
            "parent",
            "assignee",
            "created",
            "resolutiondate",
            "duedate",
            ...(sprintFieldId ? [sprintFieldId] : []),
            ...(this.epicLinkFieldId ? [this.epicLinkFieldId] : [])
          ],
          ...(this.deployment === "cloud"
            ? nextPageToken ? { nextPageToken } : {}
            : { startAt })
        }
      });

      for (const issue of response.issues ?? []) {
        const epicLink = this.epicLinkFieldId ? issue.fields[this.epicLinkFieldId] : undefined;
        const parentKey = typeof epicLink === "string" ? epicLink : issue.fields.parent?.key;
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
          ...(issue.fields.status?.statusCategory?.key
            ? { statusCategory: issue.fields.status.statusCategory.key }
            : {}),
          ...(parentKey ? { parentKey } : {}),
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
            : {}),
          ...(issue.fields.duedate
            ? { dueDate: issue.fields.duedate }
            : {})
        });
        if (result.length >= limit) break;
      }

      if (this.deployment === "data-center") {
        const count = response.issues?.length ?? 0;
        startAt = (response.startAt ?? startAt) + count;
        if (count === 0 || result.length >= limit || (response.total !== undefined && startAt >= response.total)) break;
      } else {
        nextPageToken = response.nextPageToken;
        if (response.isLast || result.length >= limit) break;
        if (!nextPageToken) {
          throw new Error("Jira issue search did not provide a page token, so the result may be incomplete. Narrow the JQL query or retry.");
        }
      }
    } while (result.length < limit);

    return result;
  }

  async searchEpicGroups(): Promise<EpicGroup[]> {
    const epics = await this.searchIssues(this.settings.epicJql, 31);
    if (epics.length > 30) {
      throw new Error("The epic query returned more than 30 epics. Narrow Epic JQL to keep the timeline readable.");
    }
    if (this.deployment === "data-center" && epics.length > 0 && !this.epicLinkFieldId) {
      throw new Error("Jira Data Center did not expose the Epic Link field. Ask your Jira administrator to make it available for issue search.");
    }
    const groups = new Map<string, EpicGroup>();
    for (const epic of epics) groups.set(epic.key, { epic, children: [] });
    for (let offset = 0; offset < epics.length; offset += 20) {
      const keys = epics.slice(offset, offset + 20).map((epic) => epic.key);
      const relation = this.deployment === "data-center" ? '"Epic Link"' : "parent";
      const jql = `${relation} in (${keys.map((key) => `"${key.replace(/"/g, '\\"')}"`).join(", ")}) ORDER BY created ASC`;
      const children = await this.searchIssues(jql, 1001);
      if (children.length > 1000) {
        throw new Error("More than 1,000 children matched one epic batch. Narrow Epic JQL so no work is omitted.");
      }
      for (const child of children) {
        const group = child.parentKey ? groups.get(child.parentKey) : undefined;
        if (!group) {
          throw new Error(`Jira did not return the epic parent for ${child.key}. Check access to the parent field.`);
        }
        group.children.push(child);
      }
    }
    return [...groups.values()];
  }

  async getIssueStatusChanges(issueKey: string): Promise<StatusChange[]> {
    const histories: StatusHistory[] = [];
    if (this.deployment === "data-center") {
      const response = await this.request<DataCenterIssueResponse>(
        `${this.apiRoot}/issue/${encodeURIComponent(issueKey)}?expand=changelog&fields=summary`
      );
      const changelog = response.changelog;
      if (!changelog) throw new Error(`Jira did not return changelog history for ${issueKey}. Check issue permissions and the Data Center API response.`);
      const values = changelog.histories ?? [];
      if (changelog.total !== undefined && values.length < changelog.total) {
        throw new Error(`Jira returned only ${values.length} of ${changelog.total} changelog entries for ${issueKey}. Forecast history would be incomplete.`);
      }
      histories.push(...values);
    } else {
      let startAt = 0;

      while (true) {
        const response = await this.request<ChangelogResponse>(
          `${this.apiRoot}/issue/${encodeURIComponent(issueKey)}/changelog?startAt=${startAt}&maxResults=100`
        );
        const values = response.values ?? [];
        histories.push(...values);

        const pageSize = response.maxResults ?? values.length;
        startAt += pageSize;
        if (response.isLast || values.length === 0 || (response.total !== undefined && startAt >= response.total)) break;
      }
    }

    const result: StatusChange[] = [];
    for (const history of histories) {
      if (!history.created) continue;
      for (const item of history.items ?? []) {
        if (item.field?.toLowerCase() !== "status" && item.fieldId?.toLowerCase() !== "status") continue;
        if (!item.fromString || !item.toString) continue;
        result.push({
          createdAt: history.created,
          fromStatus: item.fromString,
          toStatus: item.toString
        });
      }
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

