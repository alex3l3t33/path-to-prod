import type { LeavePeriod } from "../types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string): Date {
  if (!DATE_PATTERN.test(value)) throw new Error(`Invalid date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
}

export function isoWeekday(date: Date): number {
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export interface CapacityCalendarConfig {
  teamSize: number;
  focusFactor: number;
  holidays: string[];
  leave: LeavePeriod[];
}

export class CapacityCalendar {
  private readonly holidays: Set<string>;

  constructor(private readonly config: CapacityCalendarConfig) {
    this.holidays = new Set(config.holidays);
  }

  isWorkday(date: Date): boolean {
    const weekday = isoWeekday(date);
    return weekday <= 5 && !this.holidays.has(toDateKey(date));
  }

  peopleAway(date: Date): number {
    const key = toDateKey(date);
    const people = new Set(
      this.config.leave
        .filter((period) => period.start <= key && key <= period.end)
        .map((period) => period.person.trim().toLocaleLowerCase())
        .filter(Boolean)
    );
    return Math.min(this.config.teamSize, people.size);
  }

  capacityFor(date: Date, parallelCapacity: number): number {
    if (!this.isWorkday(date)) return 0;
    const availableRatio =
      (this.config.teamSize - this.peopleAway(date)) / this.config.teamSize;
    return Math.max(0, parallelCapacity * this.config.focusFactor * availableRatio);
  }

  finishWork(start: Date, effortDays: number, parallelCapacity: number): Date {
    if (effortDays <= 0) return new Date(start);
    let remaining = effortDays;
    let cursor = new Date(start);
    let guard = 0;

    while (remaining > 0 && guard < 3_650) {
      remaining -= this.capacityFor(cursor, parallelCapacity);
      if (remaining > 0) cursor = addDays(cursor, 1);
      guard += 1;
    }
    if (guard >= 3_650) {
      throw new Error("The calendar could not find enough capacity within ten years.");
    }
    return cursor;
  }

  nextWorkday(date: Date): Date {
    let cursor = addDays(date, 1);
    while (!this.isWorkday(cursor)) cursor = addDays(cursor, 1);
    return cursor;
  }

  nextReleaseDay(date: Date, releaseWeekdays: number[]): Date {
    if (releaseWeekdays.length === 0) return date;
    let cursor = new Date(date);
    while (!this.isWorkday(cursor) || !releaseWeekdays.includes(isoWeekday(cursor))) {
      cursor = addDays(cursor, 1);
    }
    return cursor;
  }

  sprintEndOnOrAfter(date: Date, anchorValue: string, lengthWeeks: number): Date {
    const anchor = parseDate(anchorValue);
    const sprintDays = Math.max(1, Math.round(lengthWeeks)) * 7;
    let sprintStart = new Date(anchor);

    while (addDays(sprintStart, sprintDays).getTime() <= date.getTime()) {
      sprintStart = addDays(sprintStart, sprintDays);
    }

    let sprintEnd = addDays(sprintStart, sprintDays - 1);
    while (!this.isWorkday(sprintEnd)) sprintEnd = addDays(sprintEnd, -1);
    if (sprintEnd.getTime() >= date.getTime()) return sprintEnd;

    sprintStart = addDays(sprintStart, sprintDays);
    sprintEnd = addDays(sprintStart, sprintDays - 1);
    while (!this.isWorkday(sprintEnd)) sprintEnd = addDays(sprintEnd, -1);
    return sprintEnd;
  }
}

