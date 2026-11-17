import { addDays, parseDate, toDateKey } from "./calendar";

export interface IsoWeek {
  week: number;
  year: number;
}

export function mondayOfIsoWeek(value: string): string {
  const date = parseDate(value);
  const weekday = date.getUTCDay() || 7;
  return toDateKey(addDays(date, 1 - weekday));
}

export function isoWeek(value: string): IsoWeek {
  const date = parseDate(value);
  const weekday = date.getUTCDay() || 7;
  const thursday = addDays(date, 4 - weekday);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstWeekday = jan4.getUTCDay() || 7;
  const firstMonday = addDays(jan4, 1 - firstWeekday);
  const week = Math.floor((date.getTime() - firstMonday.getTime()) / 604_800_000) + 1;
  return { week, year };
}

export function weekLabel(value: string): string {
  const { week, year } = isoWeek(value);
  return `W${String(week).padStart(2, "0")} ${year}`;
}
