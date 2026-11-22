'use client';

import type { CalendarEvent } from '@botss/shared-types';
import { format } from 'date-fns';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { EventChip } from '@/components/calendar/calendar-event-chip';
import {
  addDays,
  sameDay,
  startOfDay,
  TYPE_DEFAULT_COLOR,
} from '@/components/calendar/calendar-shared';
import {
  GRID_SNAP_MINUTES,
  isAllDayEvent,
  layoutOverlaps,
  movedStart,
  readMeetingMeta,
  snapMinutes,
} from '@/lib/meetings/calendar-meetings';
import { cn } from '@/lib/utils';

const HOUR_PX = 52;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DRAG_THRESHOLD_PX = 5;

interface Block {
  event: CalendarEvent;
  start: Date;
  end: Date;
}

interface DragState {
  id: string;
  dx: number;
  dy: number;
  moved: boolean;
}

export function CalendarTimeGrid({
  days,
  events,
  onSelect,
  onTodoToggle,
  onCreateAt,
  onMove,
}: {
  days: Date[];
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  onTodoToggle: (todoId: string, done: boolean) => void;
  /** Click on an empty slot. */
  onCreateAt?: (start: Date) => void;
  /** A meeting dropped on a new time. */
  onMove?: (event: CalendarEvent, newStart: Date) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const origin = useRef<{ x: number; y: number; colWidth: number } | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Show the working day first.
    const scroller = rootRef.current?.parentElement;
    scroller?.scrollTo({ top: 7 * HOUR_PX });
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { allDay, timedByDay } = useMemo(() => {
    const allDayMap = new Map<string, CalendarEvent[]>();
    const timed = new Map<string, Block[]>();
    for (const d of days) {
      allDayMap.set(d.toDateString(), []);
      timed.set(d.toDateString(), []);
    }
    for (const e of events) {
      if (isAllDayEvent(e)) {
        // A multi day all-day meeting shows on each of its days.
        for (const d of days) {
          const dayStart = startOfDay(d);
          const dayEnd = addDays(dayStart, 1);
          const covers =
            e.end && e.end > e.start ? e.start < dayEnd && e.end > dayStart : sameDay(e.start, d);
          if (covers) allDayMap.get(d.toDateString())?.push(e);
        }
        continue;
      }
      const end = e.end ?? new Date(e.start.getTime() + 30 * 60_000);
      for (const d of days) {
        const dayStart = startOfDay(d);
        const dayEnd = addDays(dayStart, 1);
        if (e.start < dayEnd && end > dayStart) {
          timed.get(d.toDateString())?.push({
            event: e,
            start: e.start > dayStart ? e.start : dayStart,
            end: end < dayEnd ? end : dayEnd,
          });
        }
      }
    }
    return { allDay: allDayMap, timedByDay: timed };
  }, [days, events]);

  function minutesOf(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
  }

  function onColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>): void {
    if (!onCreateAt || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.min(23 * 60 + 30, Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30);
    const start = new Date(day);
    start.setHours(0, minutes, 0, 0);
    onCreateAt(start);
  }

  function canDrag(event: CalendarEvent): boolean {
    const meta = readMeetingMeta(event);
    return !!onMove && !!meta && meta.isOrganizer && meta.status !== 'CANCELLED';
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>, block: Block): void {
    if (!canDrag(block.event) || e.button !== 0) return;
    const colWidth = (colsRef.current?.getBoundingClientRect().width ?? 0) / days.length;
    origin.current = { x: e.clientX, y: e.clientY, colWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: block.event.id, dx: 0, dy: 0, moved: false });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>): void {
    const o = origin.current;
    if (!o) return;
    const dx = e.clientX - o.x;
    const dy = e.clientY - o.y;
    setDrag((d) =>
      d ? { ...d, dx, dy, moved: d.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX } : d,
    );
  }

  function onPointerCancel(): void {
    origin.current = null;
    setDrag(null);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>, block: Block): void {
    const o = origin.current;
    origin.current = null;
    const state = drag;
    setDrag(null);
    if (!o || !state) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!state.moved) {
      onSelect(block.event);
      return;
    }
    const dayDelta = o.colWidth > 0 ? Math.round(state.dx / o.colWidth) : 0;
    const minuteDelta = (state.dy / HOUR_PX) * 60;
    const next = movedStart(block.event.start, dayDelta, minuteDelta);
    if (next.getTime() !== block.event.start.getTime()) onMove?.(block.event, next);
  }

  function ghostStyle(id: string): React.CSSProperties | undefined {
    if (!drag || drag.id !== id || !drag.moved) return undefined;
    const colWidth = origin.current?.colWidth ?? 0;
    const dayDelta = colWidth > 0 ? Math.round(drag.dx / colWidth) : 0;
    const dy = (snapMinutes((drag.dy / HOUR_PX) * 60, GRID_SNAP_MINUTES) / 60) * HOUR_PX;
    return { transform: `translate(${dayDelta * colWidth}px, ${dy}px)`, zIndex: 30, opacity: 0.85 };
  }

  const today = new Date();

  return (
    <div ref={rootRef} className="bg-white">
      <div className="border-line sticky top-0 z-20 border-b bg-white">
        <div className="flex">
          <div className="w-14 shrink-0" />
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {days.map((d) => (
              <div key={d.toDateString()} className="border-line border-l px-1 py-1.5 text-center">
                <div className="text-ink-muted text-[10px] font-semibold uppercase tracking-wide">
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div
                  className={cn(
                    'mx-auto mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                    sameDay(d, today) ? 'bg-brand-600 text-white' : 'text-ink',
                  )}
                >
                  {d.getDate()}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-line flex border-t">
          <div className="text-ink-muted flex w-14 shrink-0 items-start justify-end pr-1.5 pt-1 text-[10px]">
            All day
          </div>
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {days.map((d) => {
              const list = allDay.get(d.toDateString()) ?? [];
              return (
                <ul
                  key={d.toDateString()}
                  role="list"
                  className="border-line min-h-[28px] space-y-0.5 border-l p-0.5"
                >
                  {list.slice(0, 5).map((e) => (
                    <EventChip
                      key={`${e.id}-${d.toDateString()}`}
                      event={e}
                      onClick={() => onSelect(e)}
                      onTodoToggle={onTodoToggle}
                    />
                  ))}
                  {list.length > 5 ? (
                    <li className="text-ink-muted text-[10px]">+{list.length - 5} more</li>
                  ) : null}
                </ul>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex" style={{ height: HOUR_PX * 24 }}>
        <div className="relative w-14 shrink-0">
          {HOURS.map((h) => (
            <div
              key={h}
              className="text-ink-muted absolute right-1.5 -translate-y-1/2 text-[10px]"
              style={{ top: h * HOUR_PX }}
            >
              {h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}
            </div>
          ))}
        </div>
        <div
          ref={colsRef}
          className="grid flex-1"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((d) => {
            const blocks = timedByDay.get(d.toDateString()) ?? [];
            const placed = layoutOverlaps(blocks, (b) => ({
              start: b.start.getTime(),
              end: Math.max(b.end.getTime(), b.start.getTime() + 15 * 60_000),
            }));
            const isToday = sameDay(d, today);
            return (
              <div
                key={d.toDateString()}
                className="border-line relative border-l"
                onClick={(e) => onColumnClick(d, e)}
                role="presentation"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-line, #e5e7eb) ${HOUR_PX - 1}px, var(--color-line, #e5e7eb) ${HOUR_PX}px)`,
                }}
              >
                {placed.map(({ item, column, columns }) => {
                  const e = item.event;
                  const color = e.color ?? TYPE_DEFAULT_COLOR[e.type];
                  const top = (minutesOf(item.start) / 60) * HOUR_PX;
                  const endMin = sameDay(item.end, item.start) ? minutesOf(item.end) : 24 * 60;
                  const height = Math.max(
                    18,
                    ((endMin - minutesOf(item.start)) / 60) * HOUR_PX - 2,
                  );
                  const draggable = canDrag(e);
                  const cancelled = readMeetingMeta(e)?.status === 'CANCELLED';
                  return (
                    <button
                      key={`${e.id}-${d.toDateString()}`}
                      type="button"
                      onPointerDown={(ev) => onPointerDown(ev, item)}
                      onPointerMove={onPointerMove}
                      onPointerUp={(ev) => onPointerUp(ev, item)}
                      onPointerCancel={onPointerCancel}
                      onClick={(ev) => {
                        // Draggable blocks select on pointer up; others select on click.
                        if (!draggable) onSelect(e);
                        ev.stopPropagation();
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          onSelect(e);
                        }
                      }}
                      className={cn(
                        'absolute overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight hover:brightness-95',
                        draggable
                          ? 'cursor-grab touch-none active:cursor-grabbing'
                          : 'cursor-pointer',
                        cancelled ? 'line-through opacity-60' : '',
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${(column / columns) * 100}% + 1px)`,
                        width: `calc(${100 / columns}% - 3px)`,
                        backgroundColor: `${color}26`,
                        borderLeftColor: color,
                        color: 'inherit',
                        ...ghostStyle(e.id),
                      }}
                      aria-label={`${e.title}, ${format(e.start, 'p')}`}
                    >
                      <span className="text-ink block truncate font-semibold">{e.title}</span>
                      <span className="text-ink-muted block truncate">
                        {format(e.start, 'p')}
                        {e.end ? ` to ${format(e.end, 'p')}` : ''}
                      </span>
                    </button>
                  );
                })}
                {isToday && now ? (
                  <div
                    className="border-state-error pointer-events-none absolute left-0 right-0 z-10 border-t-2"
                    style={{ top: (minutesOf(now) / 60) * HOUR_PX }}
                    aria-hidden
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
