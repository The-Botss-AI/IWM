import { Clock, FileText, ListChecks, Video } from 'lucide-react';
import type { CalendarEventType } from '@botss/shared-types';

export type CalendarViewMode = 'day' | 'week' | 'month' | 'agenda';

export const AGENDA_DAYS = 30;

export const TYPE_LABEL: Record<CalendarEventType, string> = {
  task: 'Tasks',
  todo: 'Todos',
  time: 'Time',
  meeting: 'Meetings',
};
export const TYPE_ICON: Record<CalendarEventType, typeof ListChecks> = {
  task: ListChecks,
  todo: FileText,
  time: Clock,
  meeting: Video,
};
export const TYPE_DEFAULT_COLOR: Record<CalendarEventType, string> = {
  task: '#6366f1',
  todo: '#f59e0b',
  time: '#0d9488',
  meeting: '#0ea5e9',
};

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function endOfDay(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + 1);
  x.setMilliseconds(-1);
  return x;
}
export function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function endOfMonth(d: Date): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setMilliseconds(-1);
  return x;
}
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
export function endOfWeek(d: Date): Date {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 7);
  x.setMilliseconds(-1);
  return x;
}
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
export function fmtMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
export function fmtWeekLabel(d: Date): string {
  const start = startOfWeek(d);
  const end = addDays(start, 6);
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
export function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Range of events to load for a view anchored at `cursor`. */
export function rangeFor(view: CalendarViewMode, cursor: Date): { from: Date; to: Date } {
  switch (view) {
    case 'day':
      return { from: startOfDay(cursor), to: endOfDay(cursor) };
    case 'week':
      return { from: startOfWeek(cursor), to: endOfWeek(cursor) };
    case 'agenda':
      return { from: startOfDay(cursor), to: endOfDay(addDays(cursor, AGENDA_DAYS - 1)) };
    case 'month':
    default:
      return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
  }
}

/** The cursor after pressing Previous (-1) or Next (+1). */
export function stepCursor(view: CalendarViewMode, cursor: Date, dir: 1 | -1): Date {
  switch (view) {
    case 'day':
      return addDays(cursor, dir);
    case 'week':
      return addDays(cursor, 7 * dir);
    case 'agenda':
      return addDays(cursor, AGENDA_DAYS * dir);
    case 'month':
    default:
      return addMonths(cursor, dir);
  }
}

export function labelFor(view: CalendarViewMode, cursor: Date): string {
  switch (view) {
    case 'day':
      return fmtDayLabel(cursor);
    case 'week':
      return fmtWeekLabel(cursor);
    case 'agenda':
      return `${cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(cursor, AGENDA_DAYS - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    case 'month':
    default:
      return fmtMonthLabel(cursor);
  }
}
