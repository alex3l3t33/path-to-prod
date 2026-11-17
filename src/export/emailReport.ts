import type { EpicForecast, ForecastResult, ImportantWorkAlert, Stage } from "../types";
import { STAGES } from "../types";
import { weekLabel } from "../forecast/weeks";

export interface EmailReportInput {
  project: string;
  generatedAt: string;
  mode: "goal" | "epics";
  goal?: ForecastResult;
  epics?: EpicForecast[];
  alerts?: ImportantWorkAlert[];
}

export interface EmailReport {
  subject: string;
  text: string;
  html: string;
}

const STAGE_COLORS: Record<Stage, { surface: string; accent: string }> = {
  development: { surface: "#eaf1ff", accent: "#315baf" },
  staging: { surface: "#fff1e3", accent: "#9b5b19" },
  production: { surface: "#e6f5ed", accent: "#206b4a" }
};

function safeText(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function html(value: string): string {
  return safeText(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function dated(value: string): string {
  return `${value} · ${weekLabel(value)}`;
}

function stageCell(stage: Stage, p80: string, p95: string): string {
  const color = STAGE_COLORS[stage];
  return `<td style="background:${color.surface};padding:12px;border-bottom:1px solid #dfe3eb;vertical-align:top;color:#202632"><strong style="color:${color.accent}">P80 ${html(dated(p80))}</strong><br><span style="font-size:12px;color:#596375">P95 ${html(dated(p95))}</span></td>`;
}

function stageHeader(stage: Stage): string {
  const color = STAGE_COLORS[stage];
  const label = stage[0]?.toUpperCase() + stage.slice(1);
  return `<th style="background:${color.accent};color:#fff;padding:10px;text-align:left;font-size:12px">${label}</th>`;
}

function alertLine(alert: ImportantWorkAlert): string {
  const subject = `${alert.epicKey} ${alert.epicSummary}`;
  if (alert.state === "needs-estimate") return `${subject}: add unrefined scope to forecast this important epic.`;
  if (alert.state === "needs-target") return `${subject}: add a Jira due date to watch this Kanban epic.`;
  return `${subject}: epic P80 production ${dated(alert.forecastDate!)} is after ${alert.targetSource === "due-date" ? "Jira due" : "sprint target"} ${dated(alert.targetDate!)}.`;
}

export function buildEmailReport(input: EmailReportInput): EmailReport {
  const project = safeText(input.project) || "Jira project";
  const snapshot = input.generatedAt.slice(0, 10);
  const subject = `Path to Prod · ${project} · ${input.mode === "epics" ? "Epic timeline" : "Goal forecast"} · ${snapshot}`;
  const heading = `<div style="font-family:Arial,Helvetica,sans-serif;color:#202632;max-width:900px"><h1 style="font-size:22px;margin:0 0 4px">Path to Prod</h1><p style="color:#596375;margin:0 0 20px">${html(project)} · ${html(snapshot)} · P80 planning snapshot</p>`;
  const caveat = "Each epic uses full configured team capacity independently. Dates are planning forecasts, not a combined portfolio commitment.";

  if (input.mode === "goal") {
    if (!input.goal) throw new Error("Run a goal forecast before exporting it.");
    const goal = input.goal;
    const text = [
      `PATH TO PROD — ${project}`,
      `Generated ${snapshot}`,
      `Goal production P80: ${dated(goal.milestones.production.p80)}`,
      `${goal.issueCount} issues · ${goal.methodology === "scrum" ? `${goal.sprintLengthWeeks}-week Scrum sprints` : "Kanban flow"} · ${goal.dataConfidence} data confidence`,
      "",
      ...STAGES.map((stage) => `${stage.toUpperCase()}: P50 ${dated(goal.milestones[stage].p50)} · P80 ${dated(goal.milestones[stage].p80)} · P95 ${dated(goal.milestones[stage].p95)}`),
      "",
      ...(goal.warnings.length ? ["Data notes:", ...goal.warnings] : []),
      "Forecasts are probabilistic planning aids."
    ].join("\n");
    const cells = STAGES.map((stage) => stageCell(stage, goal.milestones[stage].p80, goal.milestones[stage].p95)).join("");
    const headers = STAGES.map(stageHeader).join("");
    const body = `<h2 style="font-size:17px;margin:0 0 7px">Goal production P80: ${html(dated(goal.milestones.production.p80))}</h2><p style="color:#596375;margin:0 0 15px">${goal.issueCount} issues · ${goal.methodology === "scrum" ? `${goal.sprintLengthWeeks}-week Scrum sprints` : "Kanban flow"} · ${goal.dataConfidence} data confidence</p><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr>${headers}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
    const notes = goal.warnings.length ? `<p style="font-size:12px;color:#596375">${goal.warnings.map(html).join("<br>")}</p>` : "";
    return { subject, text, html: `${heading}${body}${notes}<p style="font-size:12px;color:#596375">Forecasts are probabilistic planning aids.</p></div>` };
  }

  if (!input.epics) throw new Error("Run an epic forecast before exporting it.");
  const ordered = [...input.epics].sort((left, right) =>
    (left.forecast?.milestones.production.p80 ?? "9999-12-31").localeCompare(right.forecast?.milestones.production.p80 ?? "9999-12-31")
  );
  const alerts = input.alerts ?? [];
  const text = [
    `PATH TO PROD — ${project}`,
    `Generated ${snapshot}`,
    `${ordered.length} open epics · P80 planning snapshot`,
    "",
    ...ordered.flatMap((epic) => {
      const title = `${epic.epic.key} ${safeText(epic.epic.summary)} — ${epic.remainingChildren} known tickets left + ${epic.reserveTickets} unrefined reserve`;
      if (!epic.forecast) return [title, "  No remaining scope to forecast."];
      return [title, ...STAGES.map((stage) =>
        `  ${stage}: P80 ${dated(epic.forecast!.milestones[stage].p80)} · P95 ${dated(epic.forecast!.milestones[stage].p95)}`
      )];
    }),
    "",
    `IMPORTANT WORK WATCH — ${alerts.filter((alert) => alert.state === "risk").length} at risk`,
    ...(alerts.length ? alerts.map(alertLine) : ["No important scope is outside its target."]),
    "",
    caveat
  ].join("\n");
  const headers = `<th style="background:#333b4c;color:#fff;padding:10px;text-align:left;font-size:12px">Epic / scope</th>${STAGES.map(stageHeader).join("")}`;
  const rows = ordered.map((epic) => {
    const first = `<td style="padding:12px;border-bottom:1px solid #dfe3eb;vertical-align:top;color:#202632"><strong>${html(epic.epic.key)} · ${html(epic.epic.summary)}</strong><br><span style="font-size:12px;color:#596375">${epic.remainingChildren} known left · ${epic.reserveTickets} unrefined reserve</span></td>`;
    const rest = epic.forecast
      ? STAGES.map((stage) => stageCell(stage, epic.forecast!.milestones[stage].p80, epic.forecast!.milestones[stage].p95)).join("")
      : `<td colspan="3" style="padding:12px;border-bottom:1px solid #dfe3eb;color:#596375">No remaining scope to forecast</td>`;
    return `<tr>${first}${rest}</tr>`;
  }).join("");
  const alertHtml = alerts.length
    ? `<h2 style="font-size:16px;margin:24px 0 8px">Important work watch</h2><ul style="padding-left:20px;color:#202632">${alerts.map((alert) => `<li style="margin-bottom:6px">${html(alertLine(alert))}</li>`).join("")}</ul>`
    : "";
  const body = `<h2 style="font-size:17px;margin:0 0 12px">Epic timeline · ${ordered.length} open epics</h2><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>${alertHtml}<p style="font-size:12px;color:#596375">${html(caveat)}</p>`;
  return { subject, text, html: `${heading}${body}</div>` };
}

export async function copyEmailReport(report: EmailReport): Promise<"rich" | "plain"> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([report.html], { type: "text/html" }),
        "text/plain": new Blob([report.text], { type: "text/plain" })
      })]);
      return "rich";
    } catch {
      // Some clipboard providers accept text only.
    }
  }
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this Obsidian session.");
  await navigator.clipboard.writeText(report.text);
  return "plain";
}
