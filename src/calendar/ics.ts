import { addDays, parseDate, toDateKey } from "../forecast/calendar";

export interface IcsAllDayEvent {
  start: string;
  endExclusive: string;
  summary: string;
}

function unfoldLines(value: string): string[] {
  return value.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function dateValue(value: string | undefined): string | undefined {
  if (!value || !/^\d{8}$/.test(value)) return undefined;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function afterColon(line: string): string {
  const separator = line.indexOf(":");
  return separator < 0 ? "" : line.slice(separator + 1).trim();
}

export function parseAllDayEvents(value: string): IcsAllDayEvent[] {
  const events: IcsAllDayEvent[] = [];
  let lines: string[] | undefined;

  for (const line of unfoldLines(value)) {
    if (line === "BEGIN:VEVENT") {
      lines = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (!lines) continue;
      const startLine = lines.find(
        (entry) => entry.startsWith("DTSTART") && entry.includes("VALUE=DATE")
      );
      const endLine = lines.find(
        (entry) => entry.startsWith("DTEND") && entry.includes("VALUE=DATE")
      );
      const summaryLine = lines.find((entry) => entry.startsWith("SUMMARY"));
      const start = dateValue(startLine ? afterColon(startLine) : undefined);
      if (start) {
        const endExclusive =
          dateValue(endLine ? afterColon(endLine) : undefined) ??
          toDateKey(addDays(parseDate(start), 1));
        if (endExclusive > start) {
          events.push({
            start,
            endExclusive,
            summary: summaryLine ? afterColon(summaryLine) : "All-day event"
          });
        }
      }
      lines = undefined;
      continue;
    }
    lines?.push(line);
  }
  return events;
}

export function expandEventDates(event: IcsAllDayEvent): string[] {
  const dates: string[] = [];
  let cursor = parseDate(event.start);
  const end = parseDate(event.endExclusive);
  while (cursor < end && dates.length < 366) {
    dates.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

