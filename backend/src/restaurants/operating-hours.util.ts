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
): boolean {
  if (!openTime || !closeTime) return true;

  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

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
export function isWithinWeeklyHours(weeklyHours: WeeklyHours, now: Date = new Date()): boolean {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const today = weeklyHours[WEEK_DAYS[now.getDay()]];
  if (today) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (open <= close) {
      if (nowMinutes >= open && nowMinutes < close) return true;
    } else if (nowMinutes >= open) {
      return true; // evening part of today's overnight window
    }
  }

  const yesterday = weeklyHours[WEEK_DAYS[(now.getDay() + 6) % 7]];
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
): boolean {
  if (restaurant.weeklyHours && Object.keys(restaurant.weeklyHours).length > 0) {
    return isWithinWeeklyHours(restaurant.weeklyHours, now);
  }
  return isWithinOperatingHours(restaurant.openTime, restaurant.closeTime, now);
}
