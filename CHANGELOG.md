# Changelog

## 0.2.1

- Add an optional Ko-fi support link to the Obsidian plugin listing and GitHub repository.

## 0.2.0

- Forecast Jira epics from their child tickets and an adjustable reserve for unrefined work.
- Show each epic in a color-coded development, staging, and production Gantt timeline with P50, P80, and P95 dates.
- Label the timeline with ISO week numbers and clear P80 dates for every environment.
- Flag important epics and tickets manually or through configurable Jira priorities and labels, then watch their epic forecast against Jira due dates or Scrum sprint targets.
- Adjust sprint length and important-work targets from the dashboard.
- Copy an email-ready forecast with colored stage cells and a plain-text fallback, or open an email draft with a suggested subject.
- Document that each epic assumes full team capacity independently and ticket alerts use their parent epic forecast as a scope-level signal.

## 0.1.4

- Ensure declarative setting renderers return `void` even with Obsidian's chainable component types, eliminating false Promise callback warnings in the community review.

## 0.1.3

- Keep declarative setting callbacks synchronous while saving changes in the background, matching Obsidian's callback contract.

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

