import {
  isWithinRestaurantHours,
  isWithinWeeklyHours,
  WeeklyHours,
} from '../src/restaurants/operating-hours.util';

/**
 * Pure-logic tests for per-day operating hours, pinned to fixed dates so day-of-week and
 * time-of-day are deterministic. Lives in test/ as an .e2e-spec (despite needing no DB)
 * because CI's backend gate only runs `test:e2e` — same reasoning as stock-photo-service.
 *
 * Reference dates: 2026-07-06 is a Monday, 2026-07-07 a Tuesday.
 */
describe('Weekly operating hours', () => {
  const at = (iso: string) => new Date(iso);

  const weekdaysOnly: WeeklyHours = {
    monday: { open: '09:00', close: '22:00' },
    tuesday: { open: '09:00', close: '22:00' },
    wednesday: { open: '09:00', close: '22:00' },
    thursday: { open: '09:00', close: '22:00' },
    friday: { open: '09:00', close: '22:00' },
    saturday: null,
    sunday: null,
  };

  it('is open inside a normal day window and closed outside it', () => {
    expect(isWithinWeeklyHours(weekdaysOnly, at('2026-07-06T12:00:00'))).toBe(true); // Mon noon
    expect(isWithinWeeklyHours(weekdaysOnly, at('2026-07-06T08:59:00'))).toBe(false); // before open
    expect(isWithinWeeklyHours(weekdaysOnly, at('2026-07-06T22:00:00'))).toBe(false); // close is exclusive
  });

  it('is closed all day on a null day (weekend closure)', () => {
    expect(isWithinWeeklyHours(weekdaysOnly, at('2026-07-05T12:00:00'))).toBe(false); // Sunday
    expect(isWithinWeeklyHours(weekdaysOnly, at('2026-07-04T12:00:00'))).toBe(false); // Saturday
  });

  it('treats a day missing from the object as closed', () => {
    const mondayOnly: WeeklyHours = { monday: { open: '09:00', close: '22:00' } };
    expect(isWithinWeeklyHours(mondayOnly, at('2026-07-06T12:00:00'))).toBe(true);
    expect(isWithinWeeklyHours(mondayOnly, at('2026-07-07T12:00:00'))).toBe(false); // Tuesday absent
  });

  describe('overnight windows (the tricky part)', () => {
    // Monday-evening service running past midnight into Tuesday
    const lateNight: WeeklyHours = { monday: { open: '18:00', close: '02:00' } };

    it('is open during the evening portion (same calendar day)', () => {
      expect(isWithinWeeklyHours(lateNight, at('2026-07-06T20:00:00'))).toBe(true); // Mon 8pm
    });

    it("stays open past midnight via yesterday's overnight tail — even though Tuesday itself is closed", () => {
      expect(isWithinWeeklyHours(lateNight, at('2026-07-07T01:30:00'))).toBe(true); // Tue 1:30am
      expect(isWithinWeeklyHours(lateNight, at('2026-07-07T02:00:00'))).toBe(false); // tail ends
    });

    it('is closed in the dead zone between the tail and the next opening', () => {
      expect(isWithinWeeklyHours(lateNight, at('2026-07-06T10:00:00'))).toBe(false); // Mon morning
      expect(isWithinWeeklyHours(lateNight, at('2026-07-07T12:00:00'))).toBe(false); // Tue noon
    });
  });

  describe('isWithinRestaurantHours precedence', () => {
    it('uses weeklyHours when present, even if legacy fields disagree', () => {
      const r = {
        openTime: '00:00',
        closeTime: '23:59', // legacy says always open
        weeklyHours: { monday: null } as WeeklyHours, // per-day says Monday closed
      };
      expect(isWithinRestaurantHours(r, at('2026-07-06T12:00:00'))).toBe(false);
    });

    it('falls back to the legacy single window when weeklyHours is null or empty', () => {
      const legacy = { openTime: '09:00', closeTime: '22:00', weeklyHours: null };
      expect(isWithinRestaurantHours(legacy, at('2026-07-06T12:00:00'))).toBe(true);
      expect(isWithinRestaurantHours(legacy, at('2026-07-06T23:00:00'))).toBe(false);

      const empty = { openTime: '09:00', closeTime: '22:00', weeklyHours: {} };
      expect(isWithinRestaurantHours(empty, at('2026-07-06T12:00:00'))).toBe(true);
    });

    it('treats a restaurant with no hours configured at all as always open (back-compat)', () => {
      const r = { openTime: null, closeTime: null, weeklyHours: null };
      expect(isWithinRestaurantHours(r, at('2026-07-06T03:00:00'))).toBe(true);
    });
  });
});
