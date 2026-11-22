'use client';

import { Copy, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ReminderPicker } from '@/components/meetings/reminder-picker';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCreateFeedLink,
  useDefaultReminders,
  useFeedStatus,
  useMeetingsEnabled,
  useRevokeFeedLink,
  useSaveDefaultReminders,
} from '@/hooks/use-meetings';
import { copyText } from '@/lib/clipboard';
import { absoluteTime } from '@/lib/time';

/** Settings, Meetings: default reminders and the private calendar feed link. */
export function MeetingSettings() {
  const enabled = useMeetingsEnabled();
  if (!enabled) {
    return (
      <p className="text-ink-muted p-6 text-sm">Meetings are turned off for your organization.</p>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4 sm:p-6">
      <header>
        <h1 className="text-ink text-lg font-semibold">Meetings</h1>
        <p className="text-ink-muted mt-1 text-sm">
          Reminders for your meetings and a link to see them in other calendar apps.
        </p>
      </header>
      <DefaultReminders />
      <FeedLink />
    </div>
  );
}

function DefaultReminders() {
  const defaults = useDefaultReminders();
  const save = useSaveDefaultReminders();
  const [draft, setDraft] = useState<number[] | null>(null);
  useEffect(() => {
    if (defaults.ready) setDraft(defaults.reminders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.ready, JSON.stringify(defaults.reminders)]);

  const changed = draft !== null && JSON.stringify(draft) !== JSON.stringify(defaults.reminders);
  return (
    <section className="space-y-3" aria-labelledby="meeting-default-reminders">
      <div>
        <h2 id="meeting-default-reminders" className="text-ink text-sm font-semibold">
          Default reminders
        </h2>
        <p className="text-ink-muted mt-1 text-xs">
          Added to every meeting you create or are invited to. Reminders ring even when Do Not
          Disturb is on. You can change them for any single meeting.
        </p>
      </div>
      {draft === null ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ReminderPicker value={draft} onChange={setDraft} disabled={save.isPending} />
      )}
      <Button
        size="sm"
        disabled={!changed || save.isPending}
        onClick={() => draft && save.mutate(draft)}
      >
        Save default reminders
      </Button>
    </section>
  );
}

function FeedLink() {
  const status = useFeedStatus();
  const create = useCreateFeedLink();
  const revoke = useRevokeFeedLink();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const link = create.data;
  const active = status.data?.active === true;

  return (
    <section className="space-y-3" aria-labelledby="meeting-feed">
      <div>
        <h2 id="meeting-feed" className="text-ink text-sm font-semibold">
          Calendar link
        </h2>
        <p className="text-ink-muted mt-1 text-xs">
          A private link that shows your meetings in Google Calendar, Outlook or Apple Calendar.
          Anyone with the link can see your meeting titles and times, so keep it to yourself. Turn
          it off any time.
        </p>
      </div>

      {link ? (
        <div className="border-line bg-bg-subtle space-y-3 rounded-lg border p-4" role="status">
          <p className="text-ink text-xs font-medium">
            Copy your link now. For your security it is shown only once. If you lose it, make a new
            one.
          </p>
          <LinkRow label="Link for Google Calendar and Outlook" value={link.url} />
          <LinkRow label="Link for Apple Calendar (opens the app)" value={link.webcalUrl} />
        </div>
      ) : null}

      {status.isPending ? (
        <Skeleton className="h-9 w-48" />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {active ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={create.isPending}
                onClick={() => setConfirmRegenerate(true)}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Make a new link
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() => setConfirmRevoke(true)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Turn off
              </Button>
              <span className="text-ink-muted text-xs">
                Active since{' '}
                {status.data?.createdAt ? absoluteTime(status.data.createdAt) : 'unknown'}
                {status.data?.lastUsedAt
                  ? `, last used ${absoluteTime(status.data.lastUsedAt)}`
                  : ', not used yet'}
              </span>
            </>
          ) : (
            <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              Create calendar link
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="Make a new link?"
        description="The old link stops working in every calendar app that uses it."
        confirmLabel="Make a new link"
        onConfirm={() => {
          setConfirmRegenerate(false);
          create.mutate();
        }}
      />
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Turn off the calendar link?"
        description="Calendar apps that use it will stop showing your meetings."
        confirmLabel="Turn off"
        variant="destructive"
        onConfirm={() => {
          setConfirmRevoke(false);
          create.reset();
          revoke.mutate();
        }}
      />
    </section>
  );
}

function LinkRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label className="text-ink-muted text-xs">
        {label}
        <div className="mt-1 flex gap-2">
          <Input
            readOnly
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void copyText(value, 'Link copied')}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Copy
          </Button>
        </div>
      </label>
    </div>
  );
}
