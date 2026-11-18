import { describe, expect, it, vi } from "vitest";
import { migrateLegacyJiraToken, settingsWithoutJiraToken } from "../src/jira/tokenStorage";
import { TEST_SETTINGS } from "./fixtures";

describe("Jira token storage", () => {
  it("migrates a legacy token and omits it from persisted settings", () => {
    const settings = { ...TEST_SETTINGS, jiraApiToken: "old-token" };
    const secrets = { getSecret: vi.fn().mockReturnValue(null), setSecret: vi.fn() };
    expect(migrateLegacyJiraToken(settings, secrets)).toBe(true);
    expect(secrets.setSecret).toHaveBeenCalledWith("path-to-prod-jira-token", "old-token");
    expect(settings.jiraTokenSecretId).toBe("path-to-prod-jira-token");
    expect(settings.jiraApiToken).toBe("");
    expect(settingsWithoutJiraToken({ ...settings, jiraApiToken: "accidental-token" }).jiraApiToken).toBe("");
  });

  it("does not overwrite a different existing secret", () => {
    const settings = { ...TEST_SETTINGS, jiraApiToken: "old-token" };
    const secrets = { getSecret: vi.fn().mockReturnValue("other-token"), setSecret: vi.fn() };
    expect(migrateLegacyJiraToken(settings, secrets)).toBe(true);
    expect(settings.jiraTokenSecretId).toMatch(/^path-to-prod-jira-[a-f0-9-]+$/);
    expect(secrets.setSecret).toHaveBeenCalledWith(settings.jiraTokenSecretId, "old-token");
  });
});
