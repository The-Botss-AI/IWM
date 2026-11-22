'use client';

import { useCallback, useEffect, useState } from 'react';

import { useSessionContext } from '@/components/auth/session-gate';
import type { CalendarViewMode } from '@/components/calendar/calendar-shared';

const VIEWS: readonly CalendarViewMode[] = ['day', 'week', 'month', 'agenda'];
const key = (userId: string) => `botss.calendar.view.${userId}`;

function isView(v: unknown): v is CalendarViewMode {
  return typeof v === 'string' && (VIEWS as readonly string[]).includes(v);
}

/** The calendar view (day, week, month, agenda), remembered per user on this device. */
export function useCalendarViewPref(): [CalendarViewMode, (v: CalendarViewMode) => void] {
  const session = useSessionContext();
  const userId = session.data?.user?.id ?? '';
  const [view, setViewState] = useState<CalendarViewMode>('month');

  useEffect(() => {
    if (!userId) return;
    try {
      const stored = window.localStorage.getItem(key(userId));
      if (isView(stored)) setViewState(stored);
    } catch {
      /* storage blocked: keep the default */
    }
  }, [userId]);

  const setView = useCallback(
    (v: CalendarViewMode) => {
      setViewState(v);
      if (!userId) return;
      try {
        window.localStorage.setItem(key(userId), v);
      } catch {
        /* storage blocked: the choice lasts for this visit */
      }
    },
    [userId],
  );

  return [view, setView];
}
