import type { ScheduleCadence } from "./types.js";

interface CronFieldMatcher {
  matches(value: number): boolean;
}

function buildValueSet(values: Iterable<number>): Set<number> {
  return new Set(values);
}

function createRange(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function parseField(
  source: string,
  bounds: { min: number; max: number; name: string },
): CronFieldMatcher {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error(`Invalid cron ${bounds.name} field`);
  }

  const values = new Set<number>();
  for (const rawPart of trimmed.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error(`Invalid cron ${bounds.name} field`);
    }

    const [base, stepSource] = part.split("/");
    const step = stepSource === undefined ? 1 : Number.parseInt(stepSource, 10);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron ${bounds.name} step`);
    }

    if (base === "*") {
      for (const value of createRange(bounds.min, bounds.max, step)) {
        values.add(value);
      }
      continue;
    }

    const rangeMatch = base.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (start > end || start < bounds.min || end > bounds.max) {
        throw new Error(`Invalid cron ${bounds.name} range`);
      }
      for (const value of createRange(start, end, step)) {
        values.add(value);
      }
      continue;
    }

    const value = Number.parseInt(base, 10);
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      throw new Error(`Invalid cron ${bounds.name} value`);
    }
    values.add(value);
  }

  const allowed = buildValueSet(values);
  return {
    matches(value: number): boolean {
      return allowed.has(value);
    },
  };
}

interface ParsedCronExpression {
  minute: CronFieldMatcher;
  hour: CronFieldMatcher;
  dayOfMonth: CronFieldMatcher;
  month: CronFieldMatcher;
  dayOfWeek: CronFieldMatcher;
  // Standard crontab(5) semantics: when both day-of-month AND day-of-week are
  // restricted (neither is "*"), match if EITHER matches. Otherwise both are
  // applied as AND with the rest of the fields.
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

function isFieldRestricted(source: string): boolean {
  // Treat "*" or "*/N" (with no other parts) as unrestricted.
  return source
    .trim()
    .split(",")
    .some((part) => {
      const [base] = part.trim().split("/");
      return base !== "*";
    });
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron expressions must have 5 fields");
  }

  return {
    minute: parseField(parts[0], { min: 0, max: 59, name: "minute" }),
    hour: parseField(parts[1], { min: 0, max: 23, name: "hour" }),
    dayOfMonth: parseField(parts[2], { min: 1, max: 31, name: "day-of-month" }),
    month: parseField(parts[3], { min: 1, max: 12, name: "month" }),
    dayOfWeek: parseField(parts[4], { min: 0, max: 6, name: "day-of-week" }),
    dayOfMonthRestricted: isFieldRestricted(parts[2]),
    dayOfWeekRestricted: isFieldRestricted(parts[4]),
  };
}

function startOfNextMinute(date: Date): Date {
  // Local-time cron semantics: compute "next minute boundary" in the daemon's
  // local timezone so users can write "0 9 * * *" and get 9 AM local.
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return next;
}

export function validateScheduleCadence(cadence: ScheduleCadence): void {
  if (cadence.type === "cron") {
    parseCronExpression(cadence.expression);
  } else if (cadence.type === "once") {
    const runAt = new Date(cadence.runAt);
    if (Number.isNaN(runAt.getTime())) {
      throw new Error(`Invalid 'once' runAt timestamp: ${cadence.runAt}`);
    }
  }
}

export function computeNextRunAt(cadence: ScheduleCadence, after: Date): Date {
  if (cadence.type === "once") {
    const runAt = new Date(cadence.runAt);
    // If it's already past, we return it anyway, the tick logic should handle it or it might have already run.
    // However, usually computeNextRunAt is called to schedule the NEXT run.
    return runAt;
  }

  if (cadence.type === "every") {
    return new Date(after.getTime() + cadence.everyMs);
  }

  const cron = parseCronExpression(cadence.expression);
  const limit = 366 * 24 * 60;
  let cursor = startOfNextMinute(after);

  for (let index = 0; index < limit; index += 1) {
    // Use local-time fields so cron expressions follow the daemon's timezone
    // (matches Linux cron, GitHub Actions, Vixie cron behaviour).
    const minute = cursor.getMinutes();
    const hour = cursor.getHours();
    const dayOfMonth = cursor.getDate();
    const month = cursor.getMonth() + 1;
    const dayOfWeek = cursor.getDay();

    const dayMatches =
      cron.dayOfMonthRestricted && cron.dayOfWeekRestricted
        ? cron.dayOfMonth.matches(dayOfMonth) || cron.dayOfWeek.matches(dayOfWeek)
        : cron.dayOfMonth.matches(dayOfMonth) && cron.dayOfWeek.matches(dayOfWeek);

    if (
      cron.minute.matches(minute) &&
      cron.hour.matches(hour) &&
      cron.month.matches(month) &&
      dayMatches
    ) {
      return cursor;
    }

    cursor = new Date(cursor.getTime() + 60_000);
  }

  throw new Error(`Unable to compute next run time for cron expression: ${cadence.expression}`);
}
