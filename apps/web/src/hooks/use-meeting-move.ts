'use client';

import type { CalendarEvent, Meeting } from '@botss/shared-types';
import { useState } from 'react';

import type { ScopeChoice } from '@/components/meetings/meeting-scope-dialog';
import { useMoveMeeting } from '@/hooks/use-meetings';
import { getApi } from '@/lib/api';
import { readMeetingMeta } from '@/lib/meetings/calendar-meetings';
import { buildMoveRequest } from '@/lib/meetings/meeting-form';
import { toastError } from '@/lib/toast';

interface Pending {
  meeting: Meeting;
  event: CalendarEvent;
  occurrenceStart: Date;
  newStart: Date;
}

/**
 * Dragging a meeting to a new time. A one-off meeting nobody else is in
 * moves straight away; anything else first asks which meetings the move
 * applies to and whether to tell the attendees.
 */
export function useMeetingMove() {
  const [pending, setPending] = useState<Pending | null>(null);
  const move = useMoveMeeting();

  async function begin(event: CalendarEvent, newStart: Date): Promise<void> {
    const meta = readMeetingMeta(event);
    if (!meta || !event.end) return;
    let meeting: Meeting;
    try {
      meeting = await getApi().meetings.get(meta.meetingId);
    } catch (err) {
      toastError(err, "Couldn't move the meeting");
      return;
    }
    const next: Pending = { meeting, event, occurrenceStart: meta.occurrenceStart, newStart };
    if (!meta.isRecurring && meeting.attendees.length === 0) {
      run(next, { scope: 'all', notify: false });
      return;
    }
    setPending(next);
  }

  function run(p: Pending, choice: ScopeChoice): void {
    const end = p.event.end ?? p.event.start;
    const input = buildMoveRequest(
      p.meeting,
      { start: p.event.start, end, occurrenceStart: p.occurrenceStart },
      p.newStart,
      choice.scope,
      choice.notify,
    );
    move.mutate({ id: p.meeting.id, input });
  }

  function confirm(choice: ScopeChoice): void {
    if (!pending) return;
    const p = pending;
    setPending(null);
    run(p, choice);
  }

  return {
    pending,
    recurring: !!pending && (!!pending.meeting.rrule || pending.meeting.recurrence !== null),
    hasAttendees: !!pending && pending.meeting.attendees.length > 0,
    busy: move.isPending,
    begin,
    confirm,
    cancel: () => setPending(null),
  };
}
