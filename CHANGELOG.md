# Changelog

## 0.1.2

- Make the Jira email optional: configured email uses Basic authentication, while a blank email sends the token as a Bearer credential.
- Replace raw JSON parsing failures with actionable Jira URL, HTML response, HTTP status, and authentication diagnostics.
- Accept either a Jira project key or exact project name for the `{{project}}` variable.

## 0.1.1

- Adopt Obsidian 1.13's searchable declarative settings API.
- Correct the workspace activation API compatibility declaration.
- Replace prototype wording in the README with release-ready documentation.
- Build and attest release assets in GitHub Actions.

## 0.1.0

- Forecast development, staging, and production milestones from Jira history.
- Support Scrum sprint boundaries and Kanban continuous-flow forecasting.
- Add holiday, crew leave, release-window, and ICS calendar capacity controls.
- Add developer ownership and optional historical-throughput context.
- Add configurable token holder and company Jira project variables.

