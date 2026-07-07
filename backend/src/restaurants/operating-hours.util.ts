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
