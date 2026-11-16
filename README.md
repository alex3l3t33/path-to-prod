# Path to Prod

Path to Prod is an Obsidian plugin that forecasts when a Jira goal will finish development, staging, and production. It does not require story points. Instead, it learns stage durations from completed Jira issues, finds comparable tickets, and runs a capacity-aware Monte Carlo simulation.

## Features

- Reads goal and historical tickets with configurable JQL.
- Reconstructs stage durations from Jira status changelogs.
- Matches unpointed tickets using issue type, component, labels, priority, and summary words.
- Produces P50, P80, and P95 milestone dates.
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

1. Create a dedicated Atlassian API token.
2. Enter the Jira site URL, token holder, Atlassian email, API token, and company Jira project key in plugin settings.
3. Set a completed-ticket JQL query and a goal JQL query. Use `{{project}}` to reference the configured company project key.
4. Map the team's Jira statuses to development, staging, and production.
5. Select Scrum, Kanban, or auto detection. For Scrum, set the sprint length and a known sprint start date.
6. Add holidays, leave, capacity, focus factor, and release weekdays. Optionally add HTTPS ICS holiday feeds and one all-day leave feed per crew member.
7. Open **Path to Prod**, sync history, and run the forecast.

Path to Prod uses Jira basic authentication with an email and a dedicated API token. Credentials stay in the vault's local plugin data; use a revocable token and protect access to the vault.

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

