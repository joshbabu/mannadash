// Restaurant operating hours are wall-clock times in India (this is a Hyderabad-only
// platform — INR, GST, Hyderabad geodata). They must be evaluated against the current
// India wall-clock, NOT the server's local time — production runs in UTC, so without this
// a restaurant open "08:00–03:00" was judged closed for the 5.5-hour IST/UTC gap even
// while genuinely open (e.g. 09:10 IST reads as 03:40 UTC, outside the window).
export const RESTAURANT_TIME_ZONE = 'Asia/Kolkata';

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Wall-clock day-of-week (0 = Sunday, matching Date.getDay()) and minutes-since-midnight for
 * an instant, as observed in the given IANA time zone. When `timeZone` is omitted, falls back
 * to the host's local interpretation of the Date — preserving the original behavior for the
 * pure-logic unit tests, which construct fixed wall-clock instants.
 */
export function wallClockParts(now: Date, timeZone?: string): { day: number; minutes: number } {
  if (!timeZone) {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  return { day: WEEKDAY_INDEX[map.weekday] ?? now.getDay(), minutes: hour * 60 + parseInt(map.minute, 10) };
}

/**
 * Checks whether the current time falls within a restaurant's daily operating hours.
 * If either openTime or closeTime is unset, treats the restaurant as always-open (backward
 * compatible with restaurants that never configured hours).
 *
 * Handles overnight hours correctly (e.g. open 18:00, close 02:00 spans midnight).
 */
export function isWithinOperatingHours(
  openTime: string | null,
  closeTime: string | null,
  now: Date = new Date(),
  timeZone?: string,
): boolean {
  if (!openTime || !closeTime) return true;

  const openMinutes = toMinutes(openTime);
  const closeMinutes = toMinutes(closeTime);
  const { minutes: nowMinutes } = wallClockParts(now, timeZone);

  if (openMinutes <= closeMinutes) {
    // Normal same-day window, e.g. 09:00–22:00
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  }
  // Overnight window, e.g. 18:00–02:00 — open if after opening OR before closing
  return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
}

// === Per-day weekly hours (onboarding wizard) ===

// A single day's window, HH:MM 24-hour. `null` means closed that entire day.
export type DayHours = { open: string; close: string } | null;

export const WEEK_DAYS = [
  'sunday', // index 0 matches Date.getDay()
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

export type WeeklyHours = Partial<Record<WeekDay, DayHours>>;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Per-day version of the operating hours check. Two windows can make "now" open:
 *  - today's window (for an overnight window like Mon 18:00–02:00, only the evening part
 *    belongs to today — being open at Tue 01:00 is Tuesday's problem, handled below)
 *  - yesterday's overnight tail (Mon 18:00–02:00 keeps the restaurant open until Tue 02:00,
 *    even if Tuesday itself is a closed day)
 * A day missing from the object or set to null = closed that day.
 */
export function isWithinWeeklyHours(weeklyHours: WeeklyHours, now: Date = new Date(), timeZone?: string): boolean {
  const { day, minutes: nowMinutes } = wallClockParts(now, timeZone);

  const today = weeklyHours[WEEK_DAYS[day]];
  if (today) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (open <= close) {
      if (nowMinutes >= open && nowMinutes < close) return true;
    } else if (nowMinutes >= open) {
      return true; // evening part of today's overnight window
    }
  }

  const yesterday = weeklyHours[WEEK_DAYS[(day + 6) % 7]];
  if (yesterday) {
    const open = toMinutes(yesterday.open);
    const close = toMinutes(yesterday.close);
    if (open > close && nowMinutes < close) return true; // yesterday's window spilling past midnight
  }

  return false;
}

/**
 * The single entry point order placement should use: per-day hours take precedence when the
 * restaurant configured them (new onboarding wizard); otherwise the legacy single daily window
 * applies (existing restaurants); neither set = always open. `isOpen` (the manual toggle) is a
 * separate check owned by the caller.
 */
export function isWithinRestaurantHours(
  restaurant: { openTime: string | null; closeTime: string | null; weeklyHours?: WeeklyHours | null },
  now: Date = new Date(),
  timeZone: string = RESTAURANT_TIME_ZONE,
): boolean {
  if (restaurant.weeklyHours && Object.keys(restaurant.weeklyHours).length > 0) {
    return isWithinWeeklyHours(restaurant.weeklyHours, now, timeZone);
  }
  return isWithinOperatingHours(restaurant.openTime, restaurant.closeTime, now, timeZone);
}
