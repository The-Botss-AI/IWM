'use client';

import type { MeetingEditScope } from '@botss/shared-types';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ScopeChoice {
  scope: MeetingEditScope;
  notify: boolean;
}

const SCOPES: { value: MeetingEditScope; label: string }[] = [
  { value: 'this', label: 'This meeting' },
  { value: 'following', label: 'This and following meetings' },
  { value: 'all', label: 'All meetings in the series' },
];

/**
 * Asks which occurrences a change applies to (recurring meetings only) and
 * whether to tell the attendees.
 */
export function MeetingScopeDialog({
  open,
  title,
  description,
  confirmLabel,
  recurring,
  hasAttendees,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  recurring: boolean;
  hasAttendees: boolean;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: (choice: ScopeChoice) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<MeetingEditScope>(recurring ? 'this' : 'all');
  const [notify, setNotify] = useState(true);

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {recurring ? (
          <fieldset className="space-y-2">
            <legend className="sr-only">Which meetings</legend>
            {SCOPES.map((s) => (
              <label
                key={s.value}
                className="text-ink flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="meeting-scope"
                  value={s.value}
                  checked={scope === s.value}
                  onChange={() => setScope(s.value)}
                  className="accent-brand-600 h-4 w-4"
                />
                {s.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        {hasAttendees ? (
          <label className="text-ink flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={notify} onCheckedChange={(c) => setNotify(c === true)} />
            Notify attendees
          </label>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Keep as is
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'primary'}
            disabled={busy}
            onClick={() =>
              onConfirm({ scope: recurring ? scope : 'all', notify: hasAttendees ? notify : false })
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
