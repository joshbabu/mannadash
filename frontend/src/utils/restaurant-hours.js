// Client-side mirror of the backend's isWithinRestaurantHours (operating-hours.util.ts) —
// used for display hints like "Closed now" tags. The backend remains the enforcement point;
// if these ever disagree, the backend wins at order time.
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function isRestaurantOpenNow(restaurant, now = new Date()) {
  if (!restaurant) return true;
  if (restaurant.isOpen === false) return false; // manual offline toggle wins outright

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekly = restaurant.weeklyHours;

  if (weekly && Object.keys(weekly).length > 0) {
    const today = weekly[DAY_KEYS[now.getDay()]];
    if (today) {
      const open = toMinutes(today.open);
      const close = toMinutes(today.close);
      if (open <= close ? nowMinutes >= open && nowMinutes < close : nowMinutes >= open) return true;
    }
    const yesterday = weekly[DAY_KEYS[(now.getDay() + 6) % 7]];
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
