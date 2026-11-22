'use client';

import type { MeetingRsvpAnswer } from '@botss/shared-types';
import { CalendarClock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { Logo } from '@/components/branding/logo';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/loader';
import { parsePreselected, usePublicRsvp } from '@/hooks/use-public-rsvp';
import { formatRange, viewerTimeZone, zoneLabel } from '@/lib/meetings/meeting-time';
import { cn } from '@/lib/utils';

const OPTIONS: { value: MeetingRsvpAnswer; label: string }[] = [
  { value: 'ACCEPTED', label: 'Yes, I will be there' },
  { value: 'TENTATIVE', label: 'Maybe' },
  { value: 'DECLINED', label: 'No, I cannot come' },
];
const ANSWER_TEXT: Record<string, string> = {
  ACCEPTED: 'You said yes.',
  TENTATIVE: 'You said maybe.',
  DECLINED: 'You said no.',
  NEEDS_ACTION: 'You have not answered yet.',
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
      <div className="border-line bg-bg-surface rounded-lg border p-6 shadow-sm">
        <div className="mb-5 flex justify-center">
          <Logo variant="full" size="sm" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function PublicRsvpView({ token }: { token: string }) {
  const params = useSearchParams();
  const rsvp = usePublicRsvp(token, parsePreselected(params.get('response')));
  const { meeting } = rsvp;
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Radio group keys: arrows move the choice (and focus) with wrap-around.
  function onOptionKey(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    const option = OPTIONS[next];
    if (!option) return;
    rsvp.setChoice(option.value);
    optionRefs.current[next]?.focus();
  }

  if (rsvp.loading) {
    return (
      <Shell>
        <PageLoader label="Opening the invitation" className="min-h-[8rem]" />
      </Shell>
    );
  }
  if (rsvp.failed || !meeting) {
    return (
      <Shell>
        <h1 className="text-ink text-lg font-semibold">This link does not work</h1>
        <p className="text-ink-muted mt-2 text-sm">
          The invitation link is invalid or has expired. Ask the organizer to send it again.
        </p>
      </Shell>
    );
  }

  const zone = viewerTimeZone();
  return (
    <Shell>
      <h1 className="text-ink text-lg font-semibold">{meeting.title}</h1>
      <p className="text-ink-muted mt-2 flex items-start gap-2 text-sm">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {formatRange(meeting.startsAt, meeting.endsAt, meeting.allDay, meeting.timeZone)}
          <span className="block text-xs">
            In your time zone ({zoneLabel(meeting.startsAt, zone)})
            {meeting.recurring ? '. Repeats' : ''}
          </span>
        </span>
      </p>

      {meeting.cancelled ? (
        <p
          role="status"
          className="border-line bg-bg-subtle text-ink mt-4 rounded-md border px-3 py-2 text-sm"
        >
          This meeting was cancelled.
        </p>
      ) : rsvp.answered ? (
        <div className="mt-4 space-y-3" role="status">
          <p className="border-line bg-bg-subtle text-ink rounded-md border px-3 py-2 text-sm">
            Thanks, your answer is saved. {ANSWER_TEXT[meeting.response] ?? ''}
          </p>
          <Button variant="secondary" size="sm" onClick={rsvp.answerAgain}>
            Change my answer
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-ink text-sm">
            Will you come?
            {meeting.response !== 'NEEDS_ACTION' ? (
              <span className="text-ink-muted"> {ANSWER_TEXT[meeting.response]}</span>
            ) : null}
          </p>
          <div role="radiogroup" aria-label="Your answer" className="space-y-2">
            {OPTIONS.map((o, i) => (
              <button
                key={o.value}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={rsvp.choice === o.value}
                tabIndex={(rsvp.choice ?? OPTIONS[0]?.value) === o.value ? 0 : -1}
                onKeyDown={(e) => onOptionKey(e, i)}
                onClick={() => rsvp.setChoice(o.value)}
                className={cn(
                  'w-full rounded-md border px-4 py-2.5 text-left text-sm transition-colors',
                  rsvp.choice === o.value
                    ? 'border-brand-purple bg-brand-gradient-soft text-ink'
                    : 'border-line text-ink hover:bg-bg-subtle bg-white',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button className="w-full" disabled={!rsvp.choice || rsvp.sending} onClick={rsvp.submit}>
            Send my answer
          </Button>
        </div>
      )}
    </Shell>
  );
}
