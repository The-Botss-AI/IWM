'use client';

import type { MeetingAttendee, MeetingResponse } from '@botss/shared-types';
import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  MapPin,
  Pencil,
  Repeat,
  Trash2,
  Video,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { MeetingDialog } from '@/components/meetings/meeting-dialog';
import { MeetingProviderIcon, providerName } from '@/components/meetings/meeting-link-badge';
import { MeetingScopeDialog } from '@/components/meetings/meeting-scope-dialog';
import { ReminderPicker } from '@/components/meetings/reminder-picker';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useMeetingDetail } from '@/hooks/use-meeting-detail';
import { useMeetingsEnabled } from '@/hooks/use-meetings';
import { openMeetingLink } from '@/lib/meetings/meeting-links';
import { formatRange, viewerTimeZone, zoneLabel } from '@/lib/meetings/meeting-time';
import { cn } from '@/lib/utils';

const RESPONSE_LABEL: Record<MeetingResponse, string> = {
  NEEDS_ACTION: 'No answer yet',
  ACCEPTED: 'Going',
  TENTATIVE: 'Maybe',
  DECLINED: 'Not going',
};
const RESPONSE_TONE: Record<MeetingResponse, 'neutral' | 'success' | 'warning' | 'danger'> = {
  NEEDS_ACTION: 'neutral',
  ACCEPTED: 'success',
  TENTATIVE: 'warning',
  DECLINED: 'danger',
};

export function MeetingDetail({ id }: { id: string }) {
  const enabled = useMeetingsEnabled();
  const d = useMeetingDetail(id);
  const { meeting, times, text } = d;
  const [reminders, setReminders] = useState<number[] | null>(null);
  useEffect(() => {
    if (meeting) setReminders(meeting.myReminders);
  }, [meeting]);

  if (!enabled) {
    return <QueryError message="Meetings are turned off for your organization." className="m-6" />;
  }
  if (d.query.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (d.query.isError || !meeting || !times || !text) {
    return (
      <QueryError
        message="Couldn't open this meeting. It may have been deleted, or you may not be invited."
        onRetry={() => void d.query.refetch()}
        className="m-6"
      />
    );
  }

  const cancelled = meeting.status === 'CANCELLED';
  const url = text.meetingUrl || null;
  const provider = providerName(url);
  const viewerZone = viewerTimeZone();
  const remindersChanged =
    reminders !== null && JSON.stringify(reminders) !== JSON.stringify(meeting.myReminders);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        href="/calendar"
        className="text-ink-muted hover:text-ink inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Calendar
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className={cn('text-ink text-xl font-semibold', cancelled ? 'line-through' : '')}>
            {text.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {url && !cancelled ? (
              <Button onClick={() => openMeetingLink(url)}>
                <Video className="h-4 w-4" aria-hidden />
                Join{provider ? ` ${provider}` : ''}
              </Button>
            ) : null}
            {meeting.isOrganizer ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => d.setEditOpen(true)}
                  disabled={cancelled}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </Button>
                {cancelled ? null : (
                  <Button variant="secondary" onClick={() => d.setCancelOpen(true)}>
                    Cancel meeting
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete meeting"
                  onClick={() => d.setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
          {meeting.status === 'TENTATIVE' ? <Badge tone="warning">Tentative</Badge> : null}
          {d.recurring ? (
            <Badge tone="outline">
              <Repeat className="h-3 w-3" aria-hidden />
              Repeats
            </Badge>
          ) : null}
          {meeting.source === 'ICS' ? <Badge tone="outline">Imported</Badge> : null}
        </div>
      </header>

      <section
        className="border-line space-y-3 rounded-lg border bg-white p-4"
        aria-label="Details"
      >
        <div className="text-ink flex items-start gap-3 text-sm">
          <CalendarClock className="text-ink-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <div>{formatRange(times.start, times.end, meeting.allDay, meeting.timeZone)}</div>
            <div className="text-ink-muted text-xs">
              Shown in your time zone ({zoneLabel(times.start, viewerZone)})
              {meeting.timeZone !== viewerZone
                ? `. Organized in ${meeting.timeZone.replace(/_/g, ' ')}`
                : ''}
            </div>
          </div>
        </div>
        {text.location ? (
          <div className="text-ink flex items-start gap-3 text-sm">
            <MapPin className="text-ink-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="break-words">{text.location}</span>
          </div>
        ) : null}
        {url ? (
          <div className="text-ink flex items-start gap-3 text-sm">
            <MeetingProviderIcon url={url} />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 inline-flex min-w-0 items-center gap-1 break-all hover:underline"
            >
              {url}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          </div>
        ) : null}
        {text.description ? (
          <p className="text-ink whitespace-pre-wrap break-words text-sm">{text.description}</p>
        ) : null}
        {meeting.lead || meeting.client || meeting.project ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {meeting.lead ? (
              <>
                <dt className="text-ink-muted">Lead</dt>
                <dd>{meeting.lead.name ?? 'A lead you cannot see'}</dd>
              </>
            ) : null}
            {meeting.client ? (
              <>
                <dt className="text-ink-muted">Client</dt>
                <dd>
                  {meeting.client.name ? (
                    <Link
                      href={`/clients/${meeting.client.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {meeting.client.name}
                    </Link>
                  ) : (
                    'A client you cannot see'
                  )}
                </dd>
              </>
            ) : null}
            {meeting.project ? (
              <>
                <dt className="text-ink-muted">Project</dt>
                <dd>
                  {meeting.project.name ? (
                    <Link
                      href={`/projects/${meeting.project.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {meeting.project.name}
                    </Link>
                  ) : (
                    'A project you cannot see'
                  )}
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </section>

      {!meeting.isOrganizer && !cancelled ? (
        <section
          className="border-line space-y-2 rounded-lg border bg-white p-4"
          aria-label="Your answer"
        >
          <h2 className="text-ink text-sm font-semibold">Are you going?</h2>
          <div className="flex flex-wrap gap-2">
            {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={meeting.myResponse === r ? 'primary' : 'secondary'}
                aria-pressed={meeting.myResponse === r}
                disabled={d.rsvpBusy}
                onClick={() => d.rsvp(r)}
              >
                {r === 'ACCEPTED' ? 'Yes' : r === 'TENTATIVE' ? 'Maybe' : 'No'}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="border-line space-y-2 rounded-lg border bg-white p-4"
        aria-label="Attendees"
      >
        <h2 className="text-ink text-sm font-semibold">People ({meeting.attendees.length + 1})</h2>
        <ul className="divide-line divide-y" role="list">
          <li className="flex items-center gap-3 py-2">
            <UserAvatar size="sm" name={meeting.organizer.name} image={meeting.organizer.image} />
            <div className="min-w-0 flex-1">
              <div className="text-ink truncate text-sm">{meeting.organizer.name}</div>
              <div className="text-ink-muted truncate text-xs">{meeting.organizer.email}</div>
            </div>
            <Badge tone="outline">Organizer</Badge>
          </li>
          {meeting.attendees.map((a) => (
            <AttendeeRow key={a.id} attendee={a} />
          ))}
        </ul>
      </section>

      <section
        className="border-line space-y-3 rounded-lg border bg-white p-4"
        aria-label="Your reminders"
      >
        <h2 className="text-ink text-sm font-semibold">Your reminders</h2>
        <ReminderPicker
          value={reminders ?? meeting.myReminders}
          onChange={setReminders}
          disabled={d.remindersBusy}
        />
        <Button
          size="sm"
          disabled={!remindersChanged || d.remindersBusy}
          onClick={() => reminders && d.saveReminders(reminders)}
        >
          Save reminders
        </Button>
      </section>

      <MeetingDialog
        open={d.editOpen}
        onOpenChange={d.setEditOpen}
        meeting={meeting}
        occurrenceStart={d.occurrenceStart}
      />
      {d.cancelOpen ? (
        <MeetingScopeDialog
          open
          title="Cancel meeting"
          description={d.recurring ? 'This meeting repeats. Choose what to cancel.' : undefined}
          confirmLabel="Cancel meeting"
          recurring={d.recurring}
          hasAttendees={d.hasAttendees}
          destructive
          busy={d.cancelBusy}
          onConfirm={d.cancelMeeting}
          onCancel={() => d.setCancelOpen(false)}
        />
      ) : null}
      {d.deleteOpen ? (
        <MeetingScopeDialog
          open
          title="Delete meeting"
          description="The whole meeting is removed for everyone. This cannot be undone."
          confirmLabel="Delete"
          recurring={false}
          hasAttendees={d.hasAttendees}
          destructive
          busy={d.deleteBusy}
          onConfirm={(c) => d.deleteMeeting(c.notify)}
          onCancel={() => d.setDeleteOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AttendeeRow({ attendee }: { attendee: MeetingAttendee }) {
  const name = attendee.name ?? attendee.email;
  return (
    <li className="flex items-center gap-3 py-2">
      <UserAvatar size="sm" name={name} image={attendee.image} />
      <div className="min-w-0 flex-1">
        <div className="text-ink truncate text-sm">{name}</div>
        <div className="text-ink-muted truncate text-xs">{attendee.email}</div>
      </div>
      {attendee.external ? <Badge tone="outline">Guest</Badge> : null}
      <Badge tone={RESPONSE_TONE[attendee.response]}>{RESPONSE_LABEL[attendee.response]}</Badge>
    </li>
  );
}
