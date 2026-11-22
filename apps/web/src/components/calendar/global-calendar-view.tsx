'use client';

import { ChevronLeft, ChevronRight, FileUp, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventType } from '@botss/shared-types';

import { CalendarAgenda } from '@/components/calendar/calendar-agenda';
import { EventChip } from '@/components/calendar/calendar-event-chip';
import {
  addDays,
  labelFor,
  rangeFor,
  sameDay,
  startOfMonth,
  startOfWeek,
  stepCursor,
  TYPE_DEFAULT_COLOR,
  TYPE_ICON,
  TYPE_LABEL,
  type CalendarViewMode,
} from '@/components/calendar/calendar-shared';
import { CalendarTimeGrid } from '@/components/calendar/calendar-time-grid';
import { IcsImportDialog } from '@/components/meetings/ics-import-dialog';
import { MeetingDialog } from '@/components/meetings/meeting-dialog';
import { MeetingScopeDialog } from '@/components/meetings/meeting-scope-dialog';
import { Button } from '@/components/ui/button';
import { useCalendarEvents } from '@/hooks/use-calendar-events';
import { useCalendarViewPref } from '@/hooks/use-calendar-view';
import { useMeetingMove } from '@/hooks/use-meeting-move';
import { useMeetingsEnabled } from '@/hooks/use-meetings';
import { useUpdateTodo } from '@/hooks/use-todos';
import { normalizeMeetingEvents, readMeetingMeta } from '@/lib/meetings/calendar-meetings';
import { nextQuarterHour } from '@/lib/meetings/meeting-form';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';

export type { CalendarViewMode };

const BASE_TYPES: CalendarEventType[] = ['task', 'todo', 'time'];
const VIEW_LABEL: Record<CalendarViewMode, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  agenda: 'Agenda',
};

interface Props {
  initialDate?: Date;
}

interface NewMeeting {
  start: Date;
  allDay: boolean;
}

export function GlobalCalendarView({ initialDate }: Props) {
  const router = useRouter();
  const meetingsOn = useMeetingsEnabled();
  const allTypes = useMemo<CalendarEventType[]>(
    () => (meetingsOn ? ['meeting', ...BASE_TYPES] : BASE_TYPES),
    [meetingsOn],
  );
  const [cursor, setCursor] = useState<Date>(initialDate ?? new Date());
  const [view, setView] = useCalendarViewPref();
  // Types the person switched off; everything else is shown, new types included.
  const [hidden, setHidden] = useState<Set<CalendarEventType>>(() => new Set());
  const types = useMemo(() => allTypes.filter((t) => !hidden.has(t)), [allTypes, hidden]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [newMeeting, setNewMeeting] = useState<NewMeeting | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const mover = useMeetingMove();

  const range = useMemo(() => rangeFor(view, cursor), [cursor, view]);
  const query = useCalendarEvents({ from: range.from, to: range.to, types });
  const updateTodo = useUpdateTodo();
  const events = useMemo(() => normalizeMeetingEvents(query.data?.items ?? []), [query.data]);

  function toggleType(t: CalendarEventType): void {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function select(e: CalendarEvent): void {
    const meta = readMeetingMeta(e);
    if (meta) {
      const occurrence = meta.isRecurring
        ? `?occurrence=${encodeURIComponent(meta.occurrenceStart.toISOString())}`
        : '';
      router.push(`/meetings/${meta.meetingId}${occurrence}`);
      return;
    }
    setSelectedEvent(e);
  }

  function toggleTodo(id: string, done: boolean): void {
    updateTodo.mutate({ id, input: { done } });
  }

  const days = useMemo(() => {
    if (view === 'day') return [range.from];
    if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
    return [];
  }, [view, range.from]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-line flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous"
            onClick={() => setCursor((d) => stepCursor(view, d, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next"
            onClick={() => setCursor((d) => stepCursor(view, d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-ink ml-2 text-sm font-semibold">{labelFor(view, cursor)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="border-line inline-flex rounded-md border bg-white p-0.5 text-xs">
            {(['day', 'week', 'month', 'agenda'] as const).map((m) => (
              <button
                key={m}
                id={`cal-view-${m}`}
                type="button"
                onClick={() => setView(m)}
                aria-pressed={view === m}
                className={cn(
                  'rounded px-2.5 py-1 transition-colors',
                  view === m ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:text-ink',
                )}
              >
                {VIEW_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {allTypes.map((t) => {
              const Icon = TYPE_ICON[t];
              const active = !hidden.has(t);
              return (
                <button
                  key={t}
                  id={`cal-filter-${t}`}
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] transition',
                    active
                      ? 'border-transparent text-white'
                      : 'border-line text-ink-muted bg-white',
                  )}
                  style={active ? { backgroundColor: TYPE_DEFAULT_COLOR[t] } : undefined}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  {TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
          {meetingsOn ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
                <FileUp className="h-3.5 w-3.5" aria-hidden />
                Import .ics
              </Button>
              <Button
                size="sm"
                onClick={() => setNewMeeting({ start: nextQuarterHour(new Date()), allDay: false })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New meeting
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="bg-bg-subtle flex-1 overflow-y-auto">
        {view === 'month' ? (
          <MonthGrid cursor={cursor} events={events} onSelect={select} onTodoToggle={toggleTodo} />
        ) : view === 'agenda' ? (
          <CalendarAgenda events={events} onSelect={select} />
        ) : (
          <CalendarTimeGrid
            days={days}
            events={events}
            onSelect={select}
            onTodoToggle={toggleTodo}
            {...(meetingsOn
              ? {
                  onCreateAt: (start: Date) => setNewMeeting({ start, allDay: false }),
                  onMove: (e: CalendarEvent, start: Date) => void mover.begin(e, start),
                }
              : {})}
          />
        )}
      </div>

      {selectedEvent ? (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      ) : null}

      {meetingsOn ? (
        <>
          <MeetingDialog
            open={newMeeting !== null}
            onOpenChange={(o) => (!o ? setNewMeeting(null) : undefined)}
            {...(newMeeting
              ? { initialStart: newMeeting.start, initialAllDay: newMeeting.allDay }
              : {})}
            onSaved={(id) => router.push(`/meetings/${id}`)}
          />
          <IcsImportDialog open={importOpen} onOpenChange={setImportOpen} />
          {mover.pending ? (
            <MeetingScopeDialog
              open
              title="Move meeting"
              description={
                mover.recurring
                  ? 'This meeting repeats. Choose what the move applies to.'
                  : undefined
              }
              confirmLabel="Move"
              recurring={mover.recurring}
              hasAttendees={mover.hasAttendees}
              busy={mover.busy}
              onConfirm={mover.confirm}
              onCancel={mover.cancel}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MonthGrid({
  cursor,
  events,
  onSelect,
  onTodoToggle,
}: {
  cursor: Date;
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  onTodoToggle: (todoId: string, done: boolean) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const cells = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  );
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const k = e.start.toDateString();
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    }
    return map;
  }, [events]);

  const today = new Date();

  return (
    <div className="p-3">
      <div className="border-line bg-line grid grid-cols-7 gap-px overflow-hidden rounded-lg border">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div
            key={d}
            className="bg-bg-subtle text-ink-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wide"
          >
            {d}
          </div>
        ))}
        {cells.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = sameDay(day, today);
          const list = eventsByDay.get(day.toDateString()) ?? [];
          return (
            <div
              key={day.toDateString()}
              className={cn(
                'min-h-[110px] bg-white p-1.5',
                inMonth ? '' : 'bg-bg-subtle/60 text-ink-disabled',
              )}
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                    isToday ? 'bg-brand-600 font-semibold text-white' : 'text-ink',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
              <ul className="space-y-0.5" role="list">
                {list.slice(0, 4).map((e) => (
                  <EventChip
                    key={e.id}
                    event={e}
                    onClick={() => onSelect(e)}
                    onTodoToggle={onTodoToggle}
                  />
                ))}
                {list.length > 4 ? (
                  <li className="text-ink-muted text-[10px]">+{list.length - 4} more</li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventDetailModal({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Event details"
      className="bg-ink/40 fixed inset-0 z-40 grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="border-line w-[min(420px,90vw)] rounded-lg border bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-ink text-base font-semibold">{event.title}</h2>
          <span className="bg-bg-subtle text-ink-muted whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide">
            {event.type}
          </span>
        </div>
        <div className="text-ink space-y-2 text-sm">
          <div className="text-ink-muted text-xs">
            {absoluteTime(event.start)}
            {event.end ? ` → ${absoluteTime(event.end)}` : ''}
          </div>
          {event.projectName ? (
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: event.color ?? '#94a3b8' }}
                aria-hidden
              />
              <span>{event.projectName}</span>
            </div>
          ) : null}
          {event.type === 'task' ? (
            <dl className="text-ink-muted grid grid-cols-2 gap-1 text-xs">
              {Object.entries(event.meta).map(([k, v]) =>
                k === 'taskId' ? null : (
                  <div key={k} className="contents">
                    <dt className="text-ink-disabled uppercase tracking-wide">{k}</dt>
                    <dd className="text-ink">{String(v ?? '-')}</dd>
                  </div>
                ),
              )}
            </dl>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {event.type === 'task' && event.projectId ? (
            <Link
              href={`/projects/${event.projectId}`}
              className="border-line text-ink hover:bg-bg-subtle rounded-md border px-3 py-1.5 text-xs font-medium"
            >
              Open project
            </Link>
          ) : null}
          {event.type === 'todo' ? (
            <Link
              href="/todo"
              className="border-line text-ink hover:bg-bg-subtle rounded-md border px-3 py-1.5 text-xs font-medium"
            >
              Open todos
            </Link>
          ) : null}
          {event.type === 'time' ? (
            <Link
              href="/timesheets"
              className="border-line text-ink hover:bg-bg-subtle rounded-md border px-3 py-1.5 text-xs font-medium"
            >
              Open timesheets
            </Link>
          ) : null}
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
