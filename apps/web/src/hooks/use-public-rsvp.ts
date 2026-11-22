'use client';

import type { MeetingRsvpAnswer, PublicMeetingRsvp } from '@botss/shared-types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getApi } from '@/lib/api';

const FROM_QUERY: Record<string, MeetingRsvpAnswer> = {
  accepted: 'ACCEPTED',
  tentative: 'TENTATIVE',
  declined: 'DECLINED',
};

/** The answer named by `?response=` in an emailed link, if any. Never sent on its own. */
export function parsePreselected(value: string | null): MeetingRsvpAnswer | null {
  return value ? (FROM_QUERY[value.toLowerCase()] ?? null) : null;
}

/**
 * The login-free RSVP page. Loading it only reads the meeting; an answer is
 * sent only when the guest presses the button (mail link scanners open every
 * link, so a link must never answer by itself).
 */
export function usePublicRsvp(token: string, preselected: MeetingRsvpAnswer | null) {
  const [choice, setChoice] = useState<MeetingRsvpAnswer | null>(preselected);
  const [saved, setSaved] = useState<PublicMeetingRsvp | null>(null);
  const query = useQuery({
    queryKey: ['public-meeting-rsvp', token],
    queryFn: () => getApi().publicMeetings.rsvp(token),
    retry: false,
    refetchOnWindowFocus: false,
    meta: { silentError: true },
  });
  const answer = useMutation({
    meta: { errorTitle: "Couldn't save your answer" },
    mutationFn: (response: MeetingRsvpAnswer) => getApi().publicMeetings.answer(token, response),
    onSuccess: (data) => setSaved(data),
  });
  return {
    meeting: saved ?? query.data ?? null,
    loading: query.isPending,
    failed: query.isError,
    choice,
    setChoice,
    submit: () => {
      if (choice) answer.mutate(choice);
    },
    sending: answer.isPending,
    answered: saved !== null,
    answerAgain: () => setSaved(null),
  };
}
