// Client-side mirror of the backend's isWithinRestaurantHours (operating-hours.util.ts) —
// used for display hints like "Closed now" tags. The backend remains the enforcement point;
// if these ever disagree, the backend wins at order time.
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Operating hours are wall-clock times in India (Hyderabad-only platform), so they must be
// evaluated against the current India wall-clock — not the customer's device timezone, which
// could be anywhere. This keeps the "Closed now" hint in sync with the backend's order-time
// enforcement (which also evaluates in Asia/Kolkata).
const RESTAURANT_TIME_ZONE = 'Asia/Kolkata';

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Day-of-week (0 = Sunday) and minutes-since-midnight for `now`, as observed in India.
function istParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: RESTAURANT_TIME_ZONE,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  return { day: WEEKDAY_INDEX[map.weekday] ?? now.getDay(), minutes: hour * 60 + parseInt(map.minute, 10) };
}

export function isRestaurantOpenNow(restaurant, now = new Date()) {
  if (!restaurant) return true;
  if (restaurant.isOpen === false) return false; // manual offline toggle wins outright

  const { day, minutes: nowMinutes } = istParts(now);
  const weekly = restaurant.weeklyHours;

  if (weekly && Object.keys(weekly).length > 0) {
    const today = weekly[DAY_KEYS[day]];
    if (today) {
      const open = toMinutes(today.open);
      const close = toMinutes(today.close);
      if (open <= close ? nowMinutes >= open && nowMinutes < close : nowMinutes >= open) return true;
    }
    const yesterday = weekly[DAY_KEYS[(day + 6) % 7]];
    if (yesterday) {
      const open = toMinutes(yesterday.open);
      const close = toMinutes(yesterday.close);
      if (open > close && nowMinutes < close) return true; // overnight tail
    }
    return false;
  }

  if (!restaurant.openTime || !restaurant.closeTime) return true; // no hours configured
  const open = toMinutes(restaurant.openTime);
  const close = toMinutes(restaurant.closeTime);
  if (open <= close) return nowMinutes >= open && nowMinutes < close;
  return nowMinutes >= open || nowMinutes < close; // overnight single window
}
