'use client';

import type { CalendarEvent } from '@botss/shared-types';

import { TYPE_DEFAULT_COLOR } from '@/components/calendar/calendar-shared';
import { cn } from '@/lib/utils';

export function EventChip({
  event,
  onClick,
  onTodoToggle,
}: {
  event: CalendarEvent;
  onClick: () => void;
  onTodoToggle: (todoId: string, done: boolean) => void;
}) {
  const color = event.color ?? TYPE_DEFAULT_COLOR[event.type];
  if (event.type === 'todo') {
    const done = (event.meta as { done?: boolean }).done === true;
    const todoId = (event.meta as { todoId?: string }).todoId ?? '';
    return (
      <li className="hover:bg-bg-subtle flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => onTodoToggle(todoId, e.target.checked)}
          aria-label={done ? 'Mark not done' : 'Mark done'}
          className="h-3 w-3 accent-amber-500"
        />
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            done ? 'text-ink-disabled line-through' : 'text-ink',
          )}
          style={{ color: done ? undefined : color }}
        >
          {event.title}
        </button>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:opacity-80"
        style={{ backgroundColor: `${color}22`, color }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="truncate font-medium">{event.title}</span>
      </button>
    </li>
  );
}
