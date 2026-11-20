import { MEETING_REMINDER_PRESETS } from '@botss/shared-types';

/** "10 minutes", "1 hour", "1 day", "90 minutes" for a reminder lead time. */
export function reminderLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? '1 day' : `${d} days`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** Same list, deduplicated and ascending. */
export function normalizeReminders(list: readonly number[]): number[] {
  return [...new Set(list)].sort((a, b) => a - b);
}

export function isPresetReminder(minutes: number): boolean {
  return (MEETING_REMINDER_PRESETS as readonly number[]).includes(minutes);
}

export type CustomUnit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<CustomUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** A custom value and unit as minutes before the start. */
export function customToMinutes(value: number, unit: CustomUnit): number {
  return Math.round(value * UNIT_MINUTES[unit]);
}
