'use client';

import type { MeetingEditScope } from '@botss/shared-types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  useCancelMeeting,
  useDeleteMeeting,
  useMeeting,
  useRsvpMeeting,
  useSetMeetingReminders,
  useSnoozeReminder,
} from '@/hooks/use-meetings';
import { occurrenceText, occurrenceTimes } from '@/lib/meetings/meeting-form';

/** Everything the meeting page needs: the meeting, the occurrence in view, and its actions. */
export function useMeetingDetail(id: string) {
  const router = useRouter();
  const params = useSearchParams();
  const query = useMeeting(id);
  const meeting = query.data;

  const occurrenceParam = params.get('occurrence');
  const occurrenceStart = useMemo(() => {
    if (!occurrenceParam) return null;
    const d = new Date(occurrenceParam);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [occurrenceParam]);
  const times = meeting ? occurrenceTimes(meeting, meeting.rrule ? occurrenceStart : null) : null;
  const text = meeting ? occurrenceText(meeting, meeting.rrule ? occurrenceStart : null) : null;
  const recurring = !!meeting && (!!meeting.rrule || meeting.recurrence !== null);

  const rsvp = useRsvpMeeting();
  const setReminders = useSetMeetingReminders();
  const cancel = useCancelMeeting();
  const remove = useDeleteMeeting({ onSuccess: () => router.push('/calendar') });
  const snooze = useSnoozeReminder();

  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // A reminder's Snooze button opens this page with ?snooze=<deliveryId> when
  // no app window could take it: snooze once, then drop the parameter.
  const snoozeParam = params.get('snooze');
  const snoozed = useRef<string | null>(null);
  useEffect(() => {
    if (!snoozeParam || snoozed.current === snoozeParam) return;
    snoozed.current = snoozeParam;
    snooze.mutate(snoozeParam);
    const next = new URLSearchParams(params.toString());
    next.delete('snooze');
    const qs = next.toString();
    router.replace(qs ? `/meetings/${id}?${qs}` : `/meetings/${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snoozeParam]);

  function cancelMeeting(choice: { scope: MeetingEditScope; notify: boolean }): void {
    setCancelOpen(false);
    cancel.mutate({
      id,
      input: {
        scope: choice.scope,
        ...(choice.scope !== 'all' && occurrenceStart ? { occurrenceStart } : {}),
        ...(choice.scope !== 'all' && !occurrenceStart && times
          ? { occurrenceStart: times.start }
          : {}),
        notifyAttendees: choice.notify,
      },
    });
  }

  return {
    query,
    meeting,
    times,
    text,
    occurrenceStart: recurring ? (occurrenceStart ?? meeting?.startsAt ?? null) : null,
    recurring,
    hasAttendees: !!meeting && meeting.attendees.length > 0,
    rsvp: (response: Parameters<typeof rsvp.mutate>[0]['response']) =>
      rsvp.mutate({ id, response }),
    rsvpBusy: rsvp.isPending,
    saveReminders: (minutesBefore: number[]) => setReminders.mutate({ id, minutesBefore }),
    remindersBusy: setReminders.isPending,
    cancelMeeting,
    cancelBusy: cancel.isPending,
    deleteMeeting: (notify: boolean) => {
      setDeleteOpen(false);
      remove.mutate({ id, notifyAttendees: notify });
    },
    deleteBusy: remove.isPending,
    editOpen,
    setEditOpen,
    cancelOpen,
    setCancelOpen,
    deleteOpen,
    setDeleteOpen,
  };
}
