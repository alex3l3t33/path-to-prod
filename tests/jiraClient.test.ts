import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_SETTINGS } from "./fixtures";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl }));

import { JiraClient } from "../src/jira/JiraClient";

function settings(overrides: Partial<typeof TEST_SETTINGS> = {}) {
  return {
    ...TEST_SETTINGS,
    jiraBaseUrl: "https://company.atlassian.net",
    jiraApiToken: "secret-token",
    jiraEmail: "person@example.com",
    ...overrides
  };
}

function json(value: unknown, status = 200) {
  return { status, text: JSON.stringify(value), headers: { "content-type": "application/json" } };
}

describe("Jira connection and paging", () => {
  beforeEach(() => requestUrl.mockReset());

  it("verifies project issue search and forecast changelog access", async () => {
    requestUrl
      .mockResolvedValueOnce(json({ issues: [{ key: "APP-1" }], isLast: true }))
      .mockResolvedValueOnce(json({ values: [], isLast: true }));
    const result = await new JiraClient(settings({ jiraProjectKey: "Application" })).testConnection();
    expect(result).toEqual({ project: "Application", sampleIssueKey: "APP-1" });
    expect(requestUrl).toHaveBeenCalledTimes(2);
    const searchRequest = requestUrl.mock.calls[0]?.[0] as { body: string };
    expect(searchRequest.body).toContain('project = \\"Application\\"');
  });

  it("reports a proxy login page without exposing its HTML", async () => {
    requestUrl.mockResolvedValue({ status: 200, text: "<html>Internal login secret</html>", headers: { "content-type": "text/html" } });
    await expect(new JiraClient(settings()).testConnection()).rejects.toThrow(/proxy, SSO gateway, or login page/);
    await expect(new JiraClient(settings()).testConnection()).rejects.not.toThrow(/Internal login secret/);
  });

  it("reports proxy authentication separately", async () => {
    requestUrl.mockResolvedValue({ status: 407, text: "proxy", headers: {} });
    await expect(new JiraClient(settings()).testConnection()).rejects.toThrow(/proxy requires authentication \(HTTP 407\)/);
  });

  it("quotes project names in JQL and never sends a token to an HTTP endpoint", async () => {
    requestUrl
      .mockResolvedValueOnce(json({ values: [] }))
      .mockResolvedValueOnce(json({ issues: [], isLast: true }));
    await new JiraClient(settings({ jiraProjectKey: "Customer Platform" })).searchIssues("project = {{project}}", 5);
    const issueRequest = requestUrl.mock.calls[1]?.[0] as { body: string };
    const issueBody = JSON.parse(issueRequest.body) as { jql: string };
    expect(issueBody.jql).toBe('project = "Customer Platform"');
    await expect(new JiraClient(settings({ jiraBaseUrl: "http://company.atlassian.net" })).testConnection()).rejects.toThrow(/HTTPS Jira API base URL/);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("supports a company HTTPS proxy base path", async () => {
    requestUrl.mockResolvedValueOnce(json({ issues: [], isLast: true }));
    await new JiraClient(settings({ jiraBaseUrl: "https://proxy.company.test/jira" })).testConnection();
    const sent = requestUrl.mock.calls[0]?.[0] as { url: string };
    expect(sent.url).toBe("https://proxy.company.test/jira/rest/api/3/search/jql");
  });

  it("auto detects a company-hosted Data Center URL and checks its changelog", async () => {
    requestUrl
      .mockResolvedValueOnce(json({ issues: [{ key: "APP-1" }], total: 1 }))
      .mockResolvedValueOnce(json({ changelog: { histories: [], total: 0 } }));
    const result = await new JiraClient(settings({
      jiraBaseUrl: "https://jira.company.test/jira",
      jiraDeployment: "auto",
      jiraEmail: ""
    })).testConnection();
    expect(result.sampleIssueKey).toBe("APP-1");
    const search = requestUrl.mock.calls[0]?.[0] as { url: string; headers: Record<string, string> };
    const history = requestUrl.mock.calls[1]?.[0] as { url: string };
    expect(search.url).toBe("https://jira.company.test/jira/rest/api/2/search");
    expect(search.headers.Authorization).toBe("Bearer secret-token");
    expect(history.url).toContain("/rest/api/2/issue/APP-1?expand=changelog");
  });

  it("paginates Data Center search by startAt", async () => {
    requestUrl
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ issues: [
        { id: "1", key: "APP-1", fields: { summary: "One" } },
        { id: "2", key: "APP-2", fields: { summary: "Two" } }
      ], startAt: 0, total: 3 }))
      .mockResolvedValueOnce(json({ issues: [
        { id: "3", key: "APP-3", fields: { summary: "Three" } }
      ], startAt: 2, total: 3 }));
    const issues = await new JiraClient(settings({ jiraDeployment: "data-center" })).searchIssues("project = {{project}}", 10);
    expect(issues.map((issue) => issue.key)).toEqual(["APP-1", "APP-2", "APP-3"]);
    const second = requestUrl.mock.calls[2]?.[0] as { body: string };
    expect((JSON.parse(second.body) as { startAt: number }).startAt).toBe(2);
  });

  it("links Data Center epic children through the Epic Link field", async () => {
    requestUrl
      .mockResolvedValueOnce(json([{ id: "customfield_101", name: "Epic Link" }]))
      .mockResolvedValueOnce(json({ issues: [{ id: "1", key: "APP-10", fields: { summary: "Epic", issuetype: { name: "Epic" } } }], total: 1 }))
      .mockResolvedValueOnce(json({ issues: [{ id: "2", key: "APP-11", fields: { summary: "Story", customfield_101: "APP-10" } }], total: 1 }));
    const groups = await new JiraClient(settings({ jiraDeployment: "data-center" })).searchEpicGroups();
    expect(groups[0]?.children.map((child) => child.key)).toEqual(["APP-11"]);
    const childrenRequest = requestUrl.mock.calls[2]?.[0] as { body: string };
    expect((JSON.parse(childrenRequest.body) as { jql: string }).jql).toContain('"Epic Link" in ("APP-10")');
  });

  it("rejects truncated Data Center changelogs", async () => {
    requestUrl.mockResolvedValueOnce(json({ changelog: { histories: [], total: 2 } }));
    await expect(new JiraClient(settings({ jiraDeployment: "data-center" })).getIssueStatusChanges("APP-1"))
      .rejects.toThrow(/Forecast history would be incomplete/);
  });

  it("reads later changelog pages when Jira omits total", async () => {
    requestUrl
      .mockResolvedValueOnce(json({ values: [{ created: "2026-11-01", items: [{ field: "status", fromString: "To Do", toString: "In Progress" }] }], maxResults: 100, isLast: false }))
      .mockResolvedValueOnce(json({ values: [{ created: "2026-11-02", items: [{ field: "status", fromString: "In Progress", toString: "Done" }] }], maxResults: 100, isLast: true }));
    const changes = await new JiraClient(settings()).getIssueStatusChanges("APP-1");
    expect(changes).toHaveLength(2);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });
});
