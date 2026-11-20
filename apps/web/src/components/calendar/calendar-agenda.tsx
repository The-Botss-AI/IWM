'use client';

import type { CalendarEvent } from '@botss/shared-types';
import { format } from 'date-fns';
import { useMemo } from 'react';

import { sameDay, TYPE_DEFAULT_COLOR, TYPE_ICON } from '@/components/calendar/calendar-shared';
import { readMeetingMeta } from '@/lib/meetings/calendar-meetings';
import { cn } from '@/lib/utils';

function timeText(e: CalendarEvent): string {
  const meta = readMeetingMeta(e);
  if (meta?.allDay || e.type === 'task' || e.type === 'todo') return 'All day';
  return e.end ? `${format(e.start, 'p')} to ${format(e.end, 'p')}` : format(e.start, 'p');
}

/** Upcoming events as a list grouped by day. */
export function CalendarAgenda({
  events,
  onSelect,
}: {
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
}) {
  const groups = useMemo(() => {
    const out: { day: Date; items: CalendarEvent[] }[] = [];
    for (const e of [...events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
      const last = out[out.length - 1];
      if (last && sameDay(last.day, e.start)) last.items.push(e);
      else out.push({ day: e.start, items: [e] });
    }
    return out;
  }, [events]);

  if (groups.length === 0) {
    return (
      <p className="text-ink-muted p-8 text-center text-sm">Nothing scheduled in this period.</p>
    );
  }
  const today = new Date();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      {groups.map((g) => (
        <section key={g.day.toDateString()} aria-label={format(g.day, 'EEEE, MMMM d')}>
          <h3
            className={cn(
              'mb-1.5 text-xs font-semibold uppercase tracking-wide',
              sameDay(g.day, today) ? 'text-brand-700' : 'text-ink-muted',
            )}
          >
            {format(g.day, 'EEEE, MMMM d')}
            {sameDay(g.day, today) ? ' (today)' : ''}
          </h3>
          <ul
            className="divide-line border-line divide-y overflow-hidden rounded-lg border bg-white"
            role="list"
          >
            {g.items.map((e) => {
              const Icon = TYPE_ICON[e.type];
              const color = e.color ?? TYPE_DEFAULT_COLOR[e.type];
              const meta = readMeetingMeta(e);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(e)}
                    className="hover:bg-bg-subtle flex w-full items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span
                      className="h-8 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <span className="text-ink-muted w-36 shrink-0 text-xs">{timeText(e)}</span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'text-ink block truncate text-sm font-medium',
                          meta?.status === 'CANCELLED' ? 'line-through' : '',
                        )}
                      >
                        {e.title}
                      </span>
                      {meta?.location ? (
                        <span className="text-ink-muted block truncate text-xs">
                          {meta.location}
                        </span>
                      ) : null}
                      {e.projectName ? (
                        <span className="text-ink-muted block truncate text-xs">
                          {e.projectName}
                        </span>
                      ) : null}
                    </span>
                    <Icon className="text-ink-muted h-4 w-4 shrink-0" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
