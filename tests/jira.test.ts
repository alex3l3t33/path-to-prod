import { describe, expect, it } from "vitest";
import { buildJiraAuthorization } from "../src/jira/auth";

describe("Jira authorization", () => {
  it("uses a Bearer credential when email is blank", () => {
    expect(buildJiraAuthorization("", "company-token")).toBe(
      "Bearer company-token"
    );
  });

  it("uses Basic authentication for an Atlassian Cloud API token", () => {
    expect(buildJiraAuthorization("dev@example.com", "api-token")).toBe(
      `Basic ${btoa("dev@example.com:api-token")}`
    );
  });
});
