import { registerDecorator, ValidationOptions } from 'class-validator';
import { WEEK_DAYS } from '../operating-hours.util';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validates the per-day hours object from the onboarding wizard:
 *   { monday: { open: '09:00', close: '22:30' }, tuesday: null, ... }
 * Rules: only real day names as keys, each value either null (closed that day) or an
 * { open, close } pair in HH:MM 24-hour format. Kept as a custom constraint because
 * class-validator's ValidateNested can't cleanly express "record of day -> (object | null)".
 */
export function IsWeeklyHours(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWeeklyHours',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must map day names (monday…sunday) to null or { open: 'HH:MM', close: 'HH:MM' }`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          for (const [day, hours] of Object.entries(value)) {
            if (!(WEEK_DAYS as readonly string[]).includes(day)) return false;
            if (hours === null) continue; // explicitly closed that day
            if (typeof hours !== 'object' || Array.isArray(hours)) return false;
            const { open, close, ...extra } = hours as Record<string, unknown>;
            if (Object.keys(extra).length > 0) return false;
            if (typeof open !== 'string' || !HHMM.test(open)) return false;
            if (typeof close !== 'string' || !HHMM.test(close)) return false;
          }
          return true;
        },
      },
    });
  };
}
