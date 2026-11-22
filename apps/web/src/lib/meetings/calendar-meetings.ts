import {
  calendarMeetingMetaSchema,
  type CalendarEvent,
  type CalendarMeetingMeta,
} from '@botss/shared-types';
import { addDays } from 'date-fns';

import { displayDay } from './meeting-time';

/** Meeting facts carried by a calendar event of type `meeting`; null for any other event. */
export function readMeetingMeta(event: CalendarEvent): CalendarMeetingMeta | null {
  if (event.type !== 'meeting') return null;
  const parsed = calendarMeetingMetaSchema.safeParse(event.meta);
  return parsed.success ? parsed.data : null;
}

/**
 * All-day meetings keep the day they have in their own zone; move their
 * start and end to that day on the viewer's calendar (local midnight, end
 * exclusive) so every view places them on the right cell. Others untouched.
 */
export function normalizeMeetingEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return events.map((e) => {
    const meta = readMeetingMeta(e);
    if (!meta || !meta.allDay || !e.end) return e;
    const start = displayDay(e.start, true, meta.timeZone);
    const end = displayDay(e.end, true, meta.timeZone);
    return { ...e, start, end: end.getTime() > start.getTime() ? end : addDays(start, 1) };
  });
}

/** True when the event belongs in the all-day strip of a time grid. */
export function isAllDayEvent(event: CalendarEvent): boolean {
  if (event.type === 'task' || event.type === 'todo') return true;
  if (event.type === 'meeting') return readMeetingMeta(event)?.allDay === true || !event.end;
  return !event.end;
}

export interface Placed<T> {
  item: T;
  /** Column among overlapping items, and how many columns that group has. */
  column: number;
  columns: number;
}

/** Side by side columns for items that overlap in time (Google Calendar style). */
export function layoutOverlaps<T>(
  items: readonly T[],
  range: (item: T) => { start: number; end: number },
): Placed<T>[] {
  const sorted = [...items].sort(
    (a, b) => range(a).start - range(b).start || range(b).end - range(a).end,
  );
  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -Infinity;
  const columnEnds: number[] = [];

  const flush = () => {
    for (const p of group) p.columns = columnEnds.length;
    placed.push(...group);
    group = [];
    columnEnds.length = 0;
    groupEnd = -Infinity;
  };

  for (const item of sorted) {
    const r = range(item);
    if (r.start >= groupEnd) flush();
    let column = columnEnds.findIndex((end) => end <= r.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(r.end);
    } else {
      columnEnds[column] = r.end;
    }
    groupEnd = Math.max(groupEnd, r.end);
    group.push({ item, column, columns: 1 });
  }
  flush();
  return placed;
}

export const GRID_SNAP_MINUTES = 15;

/** Minutes since local midnight, snapped. */
export function snapMinutes(minutes: number, step = GRID_SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/** New start of a dragged block: `dayDelta` columns across and `minuteDelta` down, snapped. */
export function movedStart(start: Date, dayDelta: number, minuteDelta: number): Date {
  const out = new Date(start);
  out.setDate(out.getDate() + dayDelta);
  const minutes = start.getHours() * 60 + start.getMinutes() + snapMinutes(minuteDelta);
  out.setHours(0, minutes, 0, 0);
  return out;
}
