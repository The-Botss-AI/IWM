'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_MEETING_REMINDERS,
  type CancelMeetingRequest,
  type CreateMeetingRequest,
  type IcsImportSelection,
  type MeetingRsvpAnswer,
  type UpdateMeetingRequest,
} from '@botss/shared-types';

import { useSessionContext } from '@/components/auth/session-gate';
import { useAddons } from '@/hooks/use-addons';
import { getApi } from '@/lib/api';

const meetingKey = (id: string) => ['meetings', 'detail', id] as const;
const listKey = (from: Date, to: Date) =>
  ['meetings', 'list', from.toISOString(), to.toISOString()] as const;
const feedKey = ['meetings', 'feed'] as const;
const preferencesKey = (userId: string) => ['me', 'preferences', userId] as const;

/** True when the organization has the Meetings add-on on (everything meetings hides otherwise). */
export function useMeetingsEnabled(): boolean {
  return useAddons().isOn('meetings');
}

function useInvalidateMeetings() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['meetings'] });
    void qc.invalidateQueries({ queryKey: ['calendar'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: meetingKey(id),
    queryFn: () => getApi().meetings.get(id),
    staleTime: 15_000,
    retry: false,
  });
}

/** Occurrences in a range, for "upcoming" lists on a lead, client or project. */
export function useMeetingList(from: Date, to: Date, enabled = true) {
  return useQuery({
    queryKey: listKey(from, to),
    queryFn: () => getApi().meetings.list({ from, to }),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateMeeting(options: { onSuccess?: (id: string) => void } = {}) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't create the meeting", successMessage: 'Meeting created' },
    mutationFn: (input: CreateMeetingRequest) => getApi().meetings.create(input),
    onSuccess: (meeting) => {
      invalidate();
      options.onSuccess?.(meeting.id);
    },
  });
}

export function useUpdateMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't save the meeting", successMessage: 'Meeting saved' },
    mutationFn: async (args: { id: string; input: UpdateMeetingRequest; reminders?: number[] }) => {
      const result = await getApi().meetings.update(args.id, args.input);
      // Reminders are the caller's own and live on their own endpoint.
      if (args.reminders) {
        await getApi().meetings.setReminders(result.newMeetingId ?? args.id, args.reminders);
      }
      return result;
    },
    onSuccess: invalidate,
  });
}

/** Drag to move: the same call, with its own wording. */
export function useMoveMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't move the meeting", successMessage: 'Meeting moved' },
    mutationFn: (args: { id: string; input: UpdateMeetingRequest }) =>
      getApi().meetings.update(args.id, args.input),
    onSuccess: invalidate,
  });
}

export function useCancelMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't cancel the meeting", successMessage: 'Meeting cancelled' },
    mutationFn: (args: { id: string; input: CancelMeetingRequest }) =>
      getApi().meetings.cancel(args.id, args.input),
    onSuccess: invalidate,
  });
}

export function useDeleteMeeting(options: { onSuccess?: () => void } = {}) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't delete the meeting", successMessage: 'Meeting deleted' },
    mutationFn: (args: { id: string; notifyAttendees: boolean }) =>
      getApi().meetings.remove(args.id, { notifyAttendees: args.notifyAttendees }),
    onSuccess: () => {
      invalidate();
      options.onSuccess?.();
    },
  });
}

export function useRsvpMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't save your answer", successMessage: 'Answer saved' },
    mutationFn: (args: { id: string; response: MeetingRsvpAnswer }) =>
      getApi().meetings.rsvp(args.id, args.response),
    onSuccess: invalidate,
  });
}

export function useSetMeetingReminders() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't save your reminders", successMessage: 'Reminders saved' },
    mutationFn: (args: { id: string; minutesBefore: number[] }) =>
      getApi().meetings.setReminders(args.id, args.minutesBefore),
    onSuccess: invalidate,
  });
}

export function useSnoozeReminder() {
  return useMutation({
    meta: { errorTitle: "Couldn't snooze the reminder", successMessage: 'Snoozed for 5 minutes' },
    mutationFn: (deliveryId: string) => getApi().meetings.snooze(deliveryId),
  });
}

/** Teammates to add: all staff, or the members of one workspace. */
export function useAttendeeCandidates(
  args: { workspaceId?: string; search?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ['meetings', 'candidates', args.workspaceId ?? null, args.search ?? ''] as const,
    queryFn: () => getApi().meetings.attendeeCandidates(args),
    enabled,
    staleTime: 30_000,
  });
}

/** One-shot fetch for "Select all" (all teammates or one workspace), not cached into the list. */
export function fetchAllCandidates(workspaceId?: string) {
  return getApi().meetings.attendeeCandidates(workspaceId ? { workspaceId } : {});
}

// ------------------------------------------------------------- import

export function usePreviewIcsImport() {
  return useMutation({
    meta: { errorTitle: "Couldn't read the calendar file" },
    mutationFn: (file: File) => getApi().meetings.previewImport(file, file.name),
  });
}

export function useImportIcs() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    meta: { errorTitle: "Couldn't import the calendar file" },
    mutationFn: (args: { file: File; selection: IcsImportSelection }) =>
      getApi().meetings.importIcs(args.file, args.selection, args.file.name),
    onSuccess: invalidate,
  });
}

// --------------------------------------------------------- feed + prefs

export function useFeedStatus() {
  return useQuery({
    queryKey: feedKey,
    queryFn: () => getApi().meetings.feedStatus(),
    staleTime: 30_000,
  });
}

export function useCreateFeedLink() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't create the calendar link" },
    mutationFn: () => getApi().meetings.createFeedLink(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: feedKey }),
  });
}

export function useRevokeFeedLink() {
  const qc = useQueryClient();
  return useMutation({
    meta: {
      errorTitle: "Couldn't turn off the calendar link",
      successMessage: 'Calendar link turned off',
    },
    mutationFn: () => getApi().meetings.revokeFeedLink(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: feedKey }),
  });
}

/** The signed-in user's default reminders (minutes before), from their synced preferences. */
export function useDefaultReminders() {
  const session = useSessionContext();
  const userId = session.data?.user?.id ?? '';
  const prefs = useQuery({
    queryKey: preferencesKey(userId),
    queryFn: () => getApi().users.preferences(),
    enabled: !!userId,
    staleTime: 60_000,
  });
  const stored = prefs.data?.preferences.meetings?.defaultReminders;
  return {
    reminders: stored ?? [...DEFAULT_MEETING_REMINDERS],
    loading: prefs.isLoading,
    ready: prefs.isSuccess || prefs.isError,
  };
}

export function useSaveDefaultReminders() {
  const qc = useQueryClient();
  const session = useSessionContext();
  const userId = session.data?.user?.id ?? '';
  return useMutation({
    meta: {
      errorTitle: "Couldn't save your default reminders",
      successMessage: 'Default reminders saved',
    },
    mutationFn: (defaultReminders: number[]) =>
      getApi().users.updatePreferences({ meetings: { defaultReminders } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: preferencesKey(userId) }),
  });
}
