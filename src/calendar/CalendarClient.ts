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
    throw new Error("Invalid calendar URL. Check the HTTPS feed address in settings.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Calendar feeds must use HTTPS.");
  }
  return url.toString();
}

async function fetchCalendar(value: string): Promise<string> {
  const url = secureUrl(value);
  let response;
  try {
    response = await requestUrl({
      url,
      method: "GET",
      headers: { Accept: "text/calendar, text/plain;q=0.9" },
      throw: false
    });
  } catch {
    throw new Error("Could not reach a calendar feed. Check the company proxy, VPN, TLS certificate, and feed access without sharing the private URL.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Calendar feed returned HTTP ${response.status}.`);
  }
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(response.text)) {
    throw new Error("A calendar feed returned an HTML login or proxy page instead of ICS data.");
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
