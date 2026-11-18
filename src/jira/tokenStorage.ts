import type { SecretStorage } from "obsidian";
import type { PathToProdSettings } from "../settings";

type JiraSecrets = Pick<SecretStorage, "getSecret" | "setSecret">;

export function migrateLegacyJiraToken(settings: PathToProdSettings, secrets: JiraSecrets): boolean {
  const legacyToken = settings.jiraApiToken.trim();
  if (!legacyToken) return false;

  let secretId = settings.jiraTokenSecretId || "path-to-prod-jira-token";
  const existing = secrets.getSecret(secretId);
  if (existing !== null && existing !== legacyToken) {
    secretId = `path-to-prod-jira-${crypto.randomUUID()}`;
  }
  secrets.setSecret(secretId, legacyToken);
  settings.jiraTokenSecretId = secretId;
  settings.jiraApiToken = "";
  return true;
}

export function settingsWithoutJiraToken(settings: PathToProdSettings): PathToProdSettings {
  return { ...settings, jiraApiToken: "" };
}
