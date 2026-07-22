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

  // Regression: operating hours are India wall-clock times, but production runs in UTC.
  // isWithinRestaurantHours must evaluate against Asia/Kolkata (+05:30), not server-local
  // time. Uses absolute UTC instants (trailing Z) so these are timezone-independent and
  // reproduce the reported bug: a restaurant open "08:00–03:00" wrongly reported closed at
  // 09:10 IST (which is 03:40 UTC — outside the window when misread as UTC).
  describe('India-timezone evaluation (Asia/Kolkata)', () => {
    const allDays = (open: string, close: string): WeeklyHours =>
      Object.fromEntries(
        ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [d, { open, close }]),
      );

    it('is OPEN at 09:10 IST for an 08:00–03:00 restaurant (the reported bug)', () => {
      const r = { openTime: null, closeTime: null, weeklyHours: allDays('08:00', '03:00') };
      // 2026-07-22T03:40:00Z === Wed 09:10 IST
      expect(isWithinRestaurantHours(r, new Date('2026-07-22T03:40:00Z'))).toBe(true);
    });

    it('is CLOSED at 07:30 IST for an 08:00–03:00 restaurant (before opening)', () => {
      const r = { openTime: null, closeTime: null, weeklyHours: allDays('08:00', '03:00') };
      // 2026-07-22T02:00:00Z === Wed 07:30 IST
      expect(isWithinRestaurantHours(r, new Date('2026-07-22T02:00:00Z'))).toBe(false);
    });

    it("is OPEN at 02:00 IST via the previous day's overnight tail", () => {
      const r = { openTime: null, closeTime: null, weeklyHours: allDays('08:00', '03:00') };
      // 2026-07-21T20:30:00Z === Wed 02:00 IST (Tuesday's 08:00–03:00 window spilling over)
      expect(isWithinRestaurantHours(r, new Date('2026-07-21T20:30:00Z'))).toBe(true);
    });

    it('applies IST to the legacy single daily window too', () => {
      const legacy = { openTime: '08:00', closeTime: '22:00', weeklyHours: null };
      expect(isWithinRestaurantHours(legacy, new Date('2026-07-22T03:40:00Z'))).toBe(true); // 09:10 IST
      expect(isWithinRestaurantHours(legacy, new Date('2026-07-22T18:00:00Z'))).toBe(false); // 23:30 IST
    });
  });
});
