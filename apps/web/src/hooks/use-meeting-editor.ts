'use client';

import type { Meeting } from '@botss/shared-types';
import { useEffect, useRef, useState } from 'react';

import { useCreateMeeting, useDefaultReminders, useUpdateMeeting } from '@/hooks/use-meetings';
import {
  blankForm,
  buildCreateRequest,
  buildUpdateRequest,
  formFromMeeting,
  nextQuarterHour,
  occurrenceTimes,
  type MeetingFormErrors,
  type MeetingFormState,
} from '@/lib/meetings/meeting-form';
import type { ScopeChoice } from '@/components/meetings/meeting-scope-dialog';

interface Args {
  /** Set when editing. */
  meeting?: Meeting;
  /** The occurrence being edited (recurring meetings). */
  occurrenceStart?: Date | null;
  /** Where a new meeting starts (a clicked slot). */
  initialStart?: Date;
  initialAllDay?: boolean;
  initialLink?: { leadId?: string; clientId?: string; projectId?: string };
  onDone: (meetingId: string) => void;
}

/** Form state, validation and saving for the meeting dialog. */
export function useMeetingEditor({
  meeting,
  occurrenceStart = null,
  initialStart,
  initialAllDay,
  initialLink,
  onDone,
}: Args) {
  const defaults = useDefaultReminders();
  const times = meeting ? occurrenceTimes(meeting, occurrenceStart) : null;
  const [initialTimes] = useState(times);
  const [form, setForm] = useState<MeetingFormState>(() =>
    meeting && times
      ? formFromMeeting(meeting, times, occurrenceStart)
      : {
          ...blankForm(
            initialStart ?? nextQuarterHour(new Date()),
            defaults.reminders,
            initialAllDay,
          ),
          leadId: initialLink?.leadId ?? null,
          clientId: initialLink?.clientId ?? null,
          projectId: initialLink?.projectId ?? null,
        },
  );
  const [errors, setErrors] = useState<MeetingFormErrors>({});
  const [notifyNew, setNotifyNew] = useState(true);
  const remindersTouched = useRef(false);
  const create = useCreateMeeting({ onSuccess: onDone });
  const update = useUpdateMeeting();

  // A new meeting starts with the person's default reminders once they arrive.
  useEffect(() => {
    if (meeting || !defaults.ready || remindersTouched.current) return;
    setForm((f) => ({ ...f, reminders: defaults.reminders }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.ready]);

  function set<K extends keyof MeetingFormState>(key: K, value: MeetingFormState[K]): void {
    if (key === 'reminders') remindersTouched.current = true;
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Keep the end after the start when the start moves.
      if (key === 'startDate' && typeof value === 'string' && value > f.endDate)
        next.endDate = value;
      return next;
    });
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  }

  const isEdit = !!meeting;
  const recurring = !!meeting && (!!meeting.rrule || meeting.recurrence !== null);
  const hasAttendees = form.people.length > 0 || form.guests.length > 0;
  const needsPrompt = isEdit && (recurring || hasAttendees);

  /** Validate; the dialog then opens the scope prompt (edit) or calls `save`. */
  function validate(): boolean {
    const probe =
      isEdit && meeting && initialTimes
        ? buildUpdateRequest(form, {
            meeting,
            initial: initialTimes,
            occurrenceStart,
            scope: 'all',
            notifyAttendees: false,
          })
        : buildCreateRequest(form, notifyNew);
    if (!probe.ok) {
      setErrors(probe.errors);
      return false;
    }
    return true;
  }

  async function save(choice?: ScopeChoice): Promise<void> {
    if (meeting && initialTimes) {
      const built = buildUpdateRequest(form, {
        meeting,
        initial: initialTimes,
        occurrenceStart,
        scope: choice?.scope ?? 'all',
        notifyAttendees: choice?.notify ?? false,
      });
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      const remindersChanged =
        JSON.stringify(form.reminders) !== JSON.stringify(meeting.myReminders);
      const result = await update.mutateAsync({
        id: meeting.id,
        input: built.value,
        ...(remindersChanged ? { reminders: form.reminders } : {}),
      });
      onDone(result.newMeetingId ?? meeting.id);
      return;
    }
    const built = buildCreateRequest(form, notifyNew);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    await create.mutateAsync(built.value);
  }

  return {
    form,
    set,
    errors,
    isEdit,
    recurring,
    hasAttendees,
    needsPrompt,
    validate,
    save,
    saving: create.isPending || update.isPending,
    notifyNew,
    setNotifyNew,
  };
}
