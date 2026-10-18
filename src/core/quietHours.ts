// Default quiet window from AGENTS.md: no warning call from 10pm to 7am.
// A missing or broken timezone fails open so a warning call is not dropped.

export interface QuietHours {
  start: string;
  end: string;
  tz: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { start: "22:00", end: "07:00", tz: "America/Los_Angeles" };

export function isQuietHours(hours: QuietHours | undefined, now = new Date()): boolean {
  const window = hours ?? DEFAULT_QUIET_HOURS;
  const minute = minuteOfDay(now, window.tz);
  const start = clockMinute(window.start);
  const end = clockMinute(window.end);
  if (minute === null || start === null || end === null || start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/** When the quiet window next ends. `now` itself when a call is allowed. */
export function quietHoursResumeAt(hours: QuietHours | undefined, now = new Date()): Date {
  if (!isQuietHours(hours, now)) return now;
  const probe = new Date(now.getTime());
  for (let step = 0; step < 24 * 4; step += 1) {
    probe.setTime(probe.getTime() + 15 * 60 * 1000);
    if (!isQuietHours(hours, probe)) return probe;
  }
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

function minuteOfDay(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function clockMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}
