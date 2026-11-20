'use client';

import { MEETING_ICS_MAX_BYTES } from '@botss/shared-types';
import { format } from 'date-fns';
import { FileUp } from 'lucide-react';
import { useRef } from 'react';

import { MeetingProviderIcon } from '@/components/meetings/meeting-link-badge';
import { Badge } from '@/components/ui/badge';
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
import { Loader } from '@/components/ui/loader';
import { useIcsImport } from '@/hooks/use-ics-import';

const MAX_MB = MEETING_ICS_MAX_BYTES / (1024 * 1024);

export function IcsImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return <IcsImportBody onOpenChange={onOpenChange} />;
}

function IcsImportBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const flow = useIcsImport();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px] p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle>Import a calendar file</DialogTitle>
          <DialogDescription>
            Bring in meetings from Google Calendar, Outlook or Apple Calendar with an .ics file (up
            to {MAX_MB} MB).
          </DialogDescription>
        </DialogHeader>

        {flow.step === 'pick' ? (
          <div className="space-y-3">
            <input
              ref={inputRef}
              type="file"
              accept=".ics,text/calendar"
              className="sr-only"
              aria-label="Calendar file"
              onChange={(e) => {
                void flow.choose(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={flow.reading}
              onClick={() => inputRef.current?.click()}
              className="border-line-strong text-ink-muted hover:bg-bg-subtle flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-sm transition-colors disabled:opacity-60"
            >
              {flow.reading ? (
                <Loader size="md" label="Reading the file" />
              ) : (
                <FileUp className="h-6 w-6" aria-hidden />
              )}
              <span>{flow.reading ? 'Reading the file' : 'Choose an .ics file'}</span>
            </button>
            {flow.fileError ? (
              <p role="alert" className="text-state-error text-sm">
                {flow.fileError}
              </p>
            ) : null}
          </div>
        ) : null}

        {flow.step === 'preview' && flow.preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-ink">
                {flow.preview.calendarName ? (
                  <strong>{flow.preview.calendarName}</strong>
                ) : (
                  'Calendar file'
                )}
                <span className="text-ink-muted">
                  {' '}
                  with {flow.preview.events.length}{' '}
                  {flow.preview.events.length === 1 ? 'event' : 'events'}
                </span>
              </span>
              <label className="text-ink flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={flow.allSelected}
                  onCheckedChange={flow.toggleAll}
                  disabled={flow.selectable.length === 0}
                />
                Select all
              </label>
            </div>
            {flow.preview.unreadable > 0 ? (
              <p className="text-ink-muted text-xs">
                {flow.preview.unreadable} {flow.preview.unreadable === 1 ? 'event' : 'events'} in
                the file could not be read and are not listed.
              </p>
            ) : null}
            <div className="border-line max-h-[50vh] overflow-auto rounded-lg border">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-bg-subtle text-ink-muted sticky top-0 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="w-10 px-3 py-2" scope="col">
                      <span className="sr-only">Import</span>
                    </th>
                    <th className="px-3 py-2" scope="col">
                      Title
                    </th>
                    <th className="px-3 py-2" scope="col">
                      When
                    </th>
                    <th className="px-3 py-2" scope="col">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {flow.preview.events.map((ev) => (
                    <tr key={ev.uid} className={ev.importable ? '' : 'opacity-60'}>
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={flow.selected.has(ev.uid)}
                          disabled={!ev.importable}
                          onCheckedChange={() => flow.toggle(ev.uid)}
                          aria-label={`Import ${ev.title}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {ev.meetingUrl ? <MeetingProviderIcon url={ev.meetingUrl} /> : null}
                          <span className="text-ink min-w-0 truncate font-medium">
                            {ev.title || 'Untitled'}
                          </span>
                        </div>
                        {ev.location ? (
                          <div className="text-ink-muted truncate text-xs">{ev.location}</div>
                        ) : null}
                      </td>
                      <td className="text-ink-muted whitespace-nowrap px-3 py-2 text-xs">
                        {ev.allDay
                          ? format(ev.startsAt, 'EEE, MMM d, yyyy')
                          : format(ev.startsAt, 'EEE, MMM d, yyyy, p')}
                        {ev.allDay ? ', all day' : ''}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {ev.recurring ? <Badge tone="outline">Repeats</Badge> : null}
                          {ev.alreadyImported ? <Badge tone="info">Already imported</Badge> : null}
                          {!ev.importable ? <Badge tone="danger">Cannot import</Badge> : null}
                        </div>
                        {!ev.importable && ev.problem ? (
                          <div className="text-state-error mt-1 text-xs">{ev.problem}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {flow.preview.events.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-ink-muted px-3 py-6 text-center">
                        This file has no events.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <DialogFooter className="items-center">
              <span className="text-ink-muted mr-auto text-xs">{flow.selected.size} selected</span>
              <Button
                type="button"
                variant="secondary"
                onClick={flow.reset}
                disabled={flow.importing}
              >
                Choose another file
              </Button>
              <Button
                type="button"
                onClick={() => void flow.runImport()}
                disabled={flow.importing || flow.selected.size === 0}
              >
                Import {flow.selected.size} {flow.selected.size === 1 ? 'event' : 'events'}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {flow.step === 'result' && flow.result ? (
          <div className="space-y-4">
            <ul className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Created" value={flow.result.created} />
              <Stat label="Updated" value={flow.result.updated} />
              <Stat label="Unchanged" value={flow.result.unchanged} />
              <Stat label="Skipped" value={flow.result.skipped} />
            </ul>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="border-line rounded-lg border px-4 py-3">
      <div className="text-ink text-2xl font-semibold">{value}</div>
      <div className="text-ink-muted text-xs">{label}</div>
    </li>
  );
}
