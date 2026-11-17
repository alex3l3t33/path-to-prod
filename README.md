# Path to Prod

Path to Prod is an Obsidian plugin that forecasts when a Jira goal will finish development, staging, and production. It does not require story points. Instead, it learns stage durations from completed Jira issues, finds comparable tickets, and runs a capacity-aware Monte Carlo simulation.

## Features

- Reads goal and historical tickets with configurable JQL.
- Reconstructs stage durations from Jira status changelogs.
- Matches unpointed tickets using issue type, component, labels, priority, and summary words.
- Produces P50, P80, and P95 milestone dates.
- Forecasts Jira epics from their child tickets, with an editable reserve for unrefined work, and shows development, staging, and production on a Gantt timeline.
- Shows each environment's P80 date beneath its colored bar and a dashed range from production P80 to P95.
- Labels the epic timeline by ISO week number and Monday start date, including the correct ISO week year around New Year.
- Copies the current dashboard as an email-ready report, with colored stage cells where rich paste is supported and a complete plain-text fallback.
- Watches important epics and tickets selected in the dashboard or identified by configurable Jira priorities and labels. Jira due dates take precedence; Scrum work without due dates is compared with a configurable sprint target.
- Auto-detects Scrum versus Kanban from Jira sprint metadata, with a manual override.
- Aligns Scrum development to configurable 1–6 week sprint boundaries; Kanban stays continuous-flow and WIP-capacity based.
- Accounts for weekdays, manual or ICS-synchronized holidays, crew leave, focus factor, parallel capacity, and production release days.
- Keeps derived history and credentials in the local Obsidian plugin data file.

Forecast dates are probabilistic planning aids, not commitments. Sparse history, workflow changes, unrecorded dependencies, and inaccurate calendar data can materially affect results.

## Development

```sh
npm install
npm run check
```

To test in Obsidian, copy or symlink this directory into a development vault at `.obsidian/plugins/path-to-prod`, run `npm run dev`, reload Obsidian, and enable **Path to Prod** under Community plugins. Use a separate development vault.

## Configure

1. Create a dedicated Jira credential: an Atlassian Cloud API token, OAuth/Bearer token, or Jira personal access token.
2. Enter the Jira root URL (not a project or board URL), token holder, token, and company Jira project key or exact name. Leave email blank for Bearer authentication; Atlassian Cloud API tokens require the Atlassian account email and use Basic authentication.
3. Set a completed-ticket JQL query and a goal JQL query. Use `{{project}}` to reference the configured company project key.
4. Map the team's Jira statuses to development, staging, and production.
5. Select Scrum, Kanban, or auto detection. For Scrum, set the sprint length and a known sprint start date.
6. Add holidays, leave, capacity, focus factor, and release weekdays. Optionally add HTTPS ICS holiday feeds and one all-day leave feed per crew member.
7. Open **Path to Prod**, sync history, and run the forecast.

To forecast epics, set **Epic JQL** and open **Epic timeline**. Adjust the unrefined reserve for each epic as its scope becomes clearer. Set sprint length and the important-work target in the dashboard. Jira priorities and labels can mark work as important automatically, and each epic or child ticket can also be marked manually. The watch compares the *epic's* P80 production date with the target for its important scope; it is a signal to review the plan, not an individual ticket completion forecast. Kanban work without a Jira due date is shown as needing a target rather than given a sprint alert. Each epic uses the full configured team capacity independently, so simultaneous epic dates are not a combined portfolio commitment.

Use **Email draft** on the goal or epic dashboard to open the default email client with a suggested subject and copy the current forecast for pasting into the draft. **Copy for email** only copies the report. Rich paste retains the colored environment cells; clients that only support plain text receive the same dates, ISO week numbers, and important-work alerts as text. The plugin does not send email or choose recipients.

Path to Prod supports Basic authentication for Atlassian Cloud API tokens and Bearer authentication when the email field is blank. Credentials stay in the vault's local plugin data; use a revocable token and protect access to the vault.

## Privacy and network access

Path to Prod makes network requests only to the configured Jira site and optional HTTPS ICS calendar feeds. Jira credentials, the token-holder variable, project key, and private calendar URLs are stored in the vault's local plugin data file. The plugin has no telemetry, analytics, advertising, or developer-operated server. Protect the vault and use dedicated, revocable credentials.

## Forecast model

For every simulation, the engine:

1. Finds up to 20 comparable historical issues for each goal ticket and stage.
2. Samples a duration from the comparable distribution.
3. Falls back to configurable assumptions when a stage lacks history.
4. Converts total stage effort into dates using team capacity and calendar availability.
5. Snaps the production milestone to an allowed release weekday.

The displayed P80 date means 80% of the simulated outcomes completed on or before that date under the configured assumptions.

### Comparable-ticket score

The score is used only to choose relevant historical tickets; it is not a developer performance score. A historical ticket receives up to 17 similarity points: same issue type (4), same priority (1), shared components (up to 4), shared labels (up to 3), and overlapping summary terms (up to 5). The engine samples real durations from the 20 closest tickets.

## Near-term roadmap

- Direct Google Calendar and Microsoft 365 OAuth connections. Provider-neutral ICS synchronization is available in the MVP.
- Jira OAuth 2.0 with PKCE or a small authorization service.
- Dependency and blocker simulation from Jira issue links.
- Per-team model calibration and forecast backtesting.
- Optional local text embeddings for stronger comparable-ticket retrieval.
- Markdown forecast snapshots and Dataview-friendly properties.

