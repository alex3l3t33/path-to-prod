import { requestUrl } from "obsidian";
import { addDays, parseDate, toDateKey } from "../forecast/calendar";
import type { CrewCalendarFeed, LeavePeriod } from "../types";
import { expandEventDates, parseAllDayEvents } from "./ics";

export interface CalendarSyncResult {
  holidays: string[];
  leave: LeavePeriod[];
}

function secureUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid calendar URL: ${value}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("Calendar feeds must use HTTPS.");
  }
  return url.toString();
}

async function fetchCalendar(value: string): Promise<string> {
  const response = await requestUrl({
    url: secureUrl(value),
    method: "GET",
    headers: { Accept: "text/calendar, text/plain;q=0.9" },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Calendar feed returned HTTP ${response.status}.`);
  }
  return response.text;
}

export class CalendarClient {
  async sync(
    holidayUrls: string[],
    crewFeeds: CrewCalendarFeed[]
  ): Promise<CalendarSyncResult> {
    const holidayCalendars = await Promise.all(holidayUrls.map(fetchCalendar));
    const crewCalendars = await Promise.all(
      crewFeeds.map(async (feed) => ({
        person: feed.person,
        value: await fetchCalendar(feed.url)
      }))
    );

    const holidays = new Set(
      holidayCalendars.flatMap((calendar) =>
        parseAllDayEvents(calendar).flatMap(expandEventDates)
      )
    );
    const leave: LeavePeriod[] = crewCalendars.flatMap(({ person, value }) =>
      parseAllDayEvents(value).map((event) => ({
        person,
        start: event.start,
        end: toDateKey(addDays(parseDate(event.endExclusive), -1))
      }))
    );

    return { holidays: [...holidays].sort(), leave };
  }
}
