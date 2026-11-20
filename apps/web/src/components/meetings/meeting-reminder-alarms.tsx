'use client';

import { BellRing, Video } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMeetingReminderAlarm } from '@/hooks/use-meeting-reminder-alarm';
import { MEETING_SNOOZE_MINUTES } from '@botss/shared-types';

/**
 * The alarm for a meeting reminder: shows over whatever page is open, with
 * Join, Snooze and Dismiss. Rings through Do Not Disturb.
 */
export function MeetingReminderAlarms({ userId }: { userId: string | null }) {
  const a = useMeetingReminderAlarm(userId);
  const first = a.alarms[0];
  if (!first) return null;
  const more = a.alarms.length - 1;
  return (
    <Dialog open onOpenChange={(o) => (!o ? a.dismiss(first) : undefined)}>
      <DialogContent className="max-w-[420px] p-6" hideClose>
        <DialogHeader>
          <div className="bg-brand-gradient mb-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-white">
            <BellRing className="h-5 w-5" aria-hidden />
          </div>
          <DialogTitle>{first.title}</DialogTitle>
          <DialogDescription>{first.body}</DialogDescription>
        </DialogHeader>
        {more > 0 ? (
          <p className="text-ink-muted text-xs">
            {more} more {more === 1 ? 'reminder' : 'reminders'} waiting
          </p>
        ) : null}
        <DialogFooter className="sm:flex-wrap">
          <Button type="button" variant="ghost" onClick={() => a.dismiss(first)}>
            Dismiss
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={a.snoozing}
            onClick={() => a.snooze(first)}
          >
            Snooze {MEETING_SNOOZE_MINUTES} min
          </Button>
          {first.meetingUrl ? (
            <Button type="button" onClick={() => a.join(first)}>
              <Video className="h-4 w-4" aria-hidden />
              Join
            </Button>
          ) : (
            <Button asChild>
              <Link href={first.url} onClick={() => a.dismiss(first)}>
                Open meeting
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
