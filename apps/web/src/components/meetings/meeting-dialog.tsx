'use client';

import type { Meeting } from '@botss/shared-types';
import { useId, useState } from 'react';

import { useSessionContext } from '@/components/auth/session-gate';
import { AttendeePicker } from '@/components/meetings/attendee-picker';
import { MeetingProviderIcon, providerName } from '@/components/meetings/meeting-link-badge';
import { MeetingScopeDialog, type ScopeChoice } from '@/components/meetings/meeting-scope-dialog';
import { ReminderPicker } from '@/components/meetings/reminder-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useClients } from '@/hooks/use-clients';
import { useLeads } from '@/hooks/use-leads';
import { useMeetingEditor } from '@/hooks/use-meeting-editor';
import { useProjects } from '@/hooks/use-projects';
import { useSalesAccess } from '@/hooks/use-sales-access';
import { detectLinkProvider } from '@/lib/meetings/meeting-links';
import {
  MEETING_COLORS,
  WEEKDAYS,
  WEEKDAY_LABEL,
  type RepeatChoice,
  type RepeatEnd,
} from '@/lib/meetings/meeting-form';
import { listTimeZones } from '@/lib/meetings/meeting-time';
import { cn } from '@/lib/utils';

const REPEAT_LABEL: Record<RepeatChoice, string> = {
  none: 'Does not repeat',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
};
const INTERVAL_UNIT: Record<Exclude<RepeatChoice, 'none'>, string> = {
  DAILY: 'day(s)',
  WEEKLY: 'week(s)',
  MONTHLY: 'month(s)',
  YEARLY: 'year(s)',
};

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-state-error mt-1 text-xs">
      {message}
    </p>
  );
}

export interface MeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set to edit; omit to create. */
  meeting?: Meeting;
  occurrenceStart?: Date | null;
  initialStart?: Date;
  initialAllDay?: boolean;
  /** Pre-link a new meeting to a record. */
  initialLink?: { leadId?: string; clientId?: string; projectId?: string };
  onSaved?: (meetingId: string) => void;
}

export function MeetingDialog(props: MeetingDialogProps) {
  // Mounted only while open so every opening starts from fresh form state.
  if (!props.open) return null;
  return <MeetingDialogBody {...props} />;
}

function MeetingDialogBody({
  onOpenChange,
  meeting,
  occurrenceStart,
  initialStart,
  initialAllDay,
  initialLink,
  onSaved,
}: MeetingDialogProps) {
  const uid = useId();
  const session = useSessionContext();
  const userId = session.data?.user?.id ?? null;
  const [scopeOpen, setScopeOpen] = useState(false);
  const editor = useMeetingEditor({
    ...(meeting ? { meeting } : {}),
    occurrenceStart: occurrenceStart ?? null,
    ...(initialStart ? { initialStart } : {}),
    ...(initialAllDay !== undefined ? { initialAllDay } : {}),
    ...(initialLink ? { initialLink } : {}),
    onDone: (id) => {
      onOpenChange(false);
      onSaved?.(id);
    },
  });
  const { form, set, errors } = editor;
  const [zones] = useState(listTimeZones);
  const provider = providerName(form.meetingUrl.trim());
  const knownLink = detectLinkProvider(form.meetingUrl.trim()) !== null;
  const title = editor.isEdit ? 'Edit meeting' : 'New meeting';

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!editor.validate()) return;
    if (editor.needsPrompt) setScopeOpen(true);
    else void editor.save();
  }

  function confirmScope(choice: ScopeChoice): void {
    setScopeOpen(false);
    void editor.save(choice);
  }

  const recurrenceLocked = form.richRecurrence;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[680px] p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <div>
              <Label htmlFor={`${uid}-title`}>Title</Label>
              <Input
                id={`${uid}-title`}
                autoFocus
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? `${uid}-title-err` : undefined}
                className="mt-1.5"
                maxLength={200}
              />
              <FieldError id={`${uid}-title-err`} message={errors.title} />
            </div>

            <fieldset className="grid gap-3">
              <legend className="sr-only">When</legend>
              <label className="text-ink flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={form.allDay}
                  onCheckedChange={(c) => set('allDay', c === true)}
                />
                All day
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className={form.allDay ? 'col-span-1 sm:col-span-2' : 'col-span-1'}>
                  <Label htmlFor={`${uid}-sd`}>Starts</Label>
                  <Input
                    id={`${uid}-sd`}
                    type="date"
                    value={form.startDate}
                    onChange={(e) => set('startDate', e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                {form.allDay ? null : (
                  <div>
                    <Label htmlFor={`${uid}-st`}>Start time</Label>
                    <Input
                      id={`${uid}-st`}
                      type="time"
                      value={form.startTime}
                      onChange={(e) => set('startTime', e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                )}
                <div className={form.allDay ? 'col-span-1 sm:col-span-2' : 'col-span-1'}>
                  <Label htmlFor={`${uid}-ed`}>{form.allDay ? 'Last day' : 'Ends'}</Label>
                  <Input
                    id={`${uid}-ed`}
                    type="date"
                    value={form.endDate}
                    min={form.startDate}
                    onChange={(e) => set('endDate', e.target.value)}
                    aria-invalid={errors.endDate ? true : undefined}
                    aria-describedby={errors.endDate ? `${uid}-ed-err` : undefined}
                    className="mt-1.5"
                  />
                </div>
                {form.allDay ? null : (
                  <div>
                    <Label htmlFor={`${uid}-et`}>End time</Label>
                    <Input
                      id={`${uid}-et`}
                      type="time"
                      value={form.endTime}
                      onChange={(e) => set('endTime', e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                )}
              </div>
              <FieldError id={`${uid}-ed-err`} message={errors.endDate ?? errors.startDate} />
              <div>
                <Label htmlFor={`${uid}-tz`}>Time zone</Label>
                <Combobox
                  id={`${uid}-tz`}
                  className="mt-1.5"
                  options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
                  value={form.timeZone}
                  onChange={(v) => v && set('timeZone', v)}
                  placeholder="Time zone"
                  searchPlaceholder="Search time zones"
                />
              </div>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="sr-only">Repeat</legend>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[10rem]">
                  <Label htmlFor={`${uid}-rep`}>Repeat</Label>
                  <Select
                    value={form.repeat}
                    onValueChange={(v) => set('repeat', v as RepeatChoice)}
                    disabled={recurrenceLocked}
                  >
                    <SelectTrigger id={`${uid}-rep`} className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(REPEAT_LABEL) as RepeatChoice[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {REPEAT_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.repeat !== 'none' && !recurrenceLocked ? (
                  <div className="text-ink flex items-center gap-2 text-sm">
                    <span>Every</span>
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={form.interval}
                      onChange={(e) => set('interval', Number(e.target.value))}
                      aria-label="Repeat interval"
                      aria-invalid={errors.interval ? true : undefined}
                      className="h-10 w-20"
                    />
                    <span>{INTERVAL_UNIT[form.repeat]}</span>
                  </div>
                ) : null}
              </div>
              {recurrenceLocked ? (
                <p className="text-ink-muted text-xs">
                  This series came from an imported calendar and repeats in a way that cannot be
                  edited here.
                </p>
              ) : null}
              <FieldError id={`${uid}-int-err`} message={errors.interval} />
              {form.repeat === 'WEEKLY' && !recurrenceLocked ? (
                <div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repeat on">
                    {WEEKDAYS.map((d) => {
                      const on = form.byDay.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            set(
                              'byDay',
                              on ? form.byDay.filter((x) => x !== d) : [...form.byDay, d],
                            )
                          }
                          className={cn(
                            'h-8 min-w-[3rem] rounded-full border px-2 text-xs transition-colors',
                            on
                              ? 'bg-brand-gradient border-transparent text-white'
                              : 'border-line text-ink hover:bg-bg-subtle bg-white',
                          )}
                        >
                          {WEEKDAY_LABEL[d]}
                        </button>
                      );
                    })}
                  </div>
                  <FieldError id={`${uid}-bd-err`} message={errors.byDay} />
                </div>
              ) : null}
              {form.repeat !== 'none' && !recurrenceLocked ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[10rem]">
                    <Label htmlFor={`${uid}-end`}>Ends</Label>
                    <Select
                      value={form.endMode}
                      onValueChange={(v) => set('endMode', v as RepeatEnd)}
                    >
                      <SelectTrigger id={`${uid}-end`} className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="until">On a date</SelectItem>
                        <SelectItem value="count">After a number of meetings</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.endMode === 'until' ? (
                    <div>
                      <Label htmlFor={`${uid}-until`}>Last day</Label>
                      <Input
                        id={`${uid}-until`}
                        type="date"
                        value={form.untilDate}
                        onChange={(e) => set('untilDate', e.target.value)}
                        className="mt-1.5"
                      />
                      <FieldError id={`${uid}-until-err`} message={errors.untilDate} />
                    </div>
                  ) : null}
                  {form.endMode === 'count' ? (
                    <div>
                      <Label htmlFor={`${uid}-count`}>Meetings</Label>
                      <Input
                        id={`${uid}-count`}
                        type="number"
                        min={1}
                        max={1000}
                        value={form.count}
                        onChange={(e) => set('count', Number(e.target.value))}
                        className="mt-1.5 w-24"
                      />
                      <FieldError id={`${uid}-count-err`} message={errors.count} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${uid}-loc`}>Location</Label>
                <Input
                  id={`${uid}-loc`}
                  value={form.location}
                  onChange={(e) => set('location', e.target.value)}
                  className="mt-1.5"
                  maxLength={500}
                />
              </div>
              <div>
                <Label htmlFor={`${uid}-url`}>Meeting link</Label>
                <div className="relative mt-1.5">
                  <Input
                    id={`${uid}-url`}
                    type="url"
                    inputMode="url"
                    value={form.meetingUrl}
                    onChange={(e) => set('meetingUrl', e.target.value)}
                    placeholder="https://meet.google.com/..."
                    aria-invalid={errors.meetingUrl ? true : undefined}
                    aria-describedby={errors.meetingUrl ? `${uid}-url-err` : undefined}
                    className={form.meetingUrl.trim() && !errors.meetingUrl ? 'pr-10' : undefined}
                  />
                  {form.meetingUrl.trim() && !errors.meetingUrl ? (
                    <MeetingProviderIcon
                      url={form.meetingUrl.trim()}
                      className="absolute right-2.5 top-2"
                    />
                  ) : null}
                </div>
                <FieldError id={`${uid}-url-err`} message={errors.meetingUrl} />
                {provider && knownLink ? (
                  <p className="text-ink-muted mt-1 text-xs">{provider} link</p>
                ) : null}
              </div>
            </div>

            <div>
              <Label htmlFor={`${uid}-desc`}>Description</Label>
              <Textarea
                id={`${uid}-desc`}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={3}
                className="mt-1.5"
                maxLength={10_000}
              />
            </div>

            <LinkPickers form={form} set={set} idPrefix={uid} />

            <div>
              <Label>Attendees</Label>
              <div className="mt-1.5">
                <AttendeePicker
                  people={form.people}
                  guests={form.guests}
                  organizerId={meeting?.organizer.id ?? userId}
                  onPeopleChange={(next) => set('people', next)}
                  onGuestsChange={(next) => set('guests', next)}
                />
              </div>
            </div>

            <div>
              <Label>Remind me</Label>
              <div className="mt-1.5">
                <ReminderPicker
                  value={form.reminders}
                  onChange={(next) => set('reminders', next)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${uid}-status`}>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => set('status', v as 'CONFIRMED' | 'TENTATIVE')}
                >
                  <SelectTrigger id={`${uid}-status`} className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                    <SelectItem value="TENTATIVE">Tentative</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Color</Label>
                <div
                  className="mt-2.5 flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Meeting color"
                >
                  <button
                    type="button"
                    aria-pressed={form.color === null}
                    onClick={() => set('color', null)}
                    className={cn(
                      'h-6 rounded-full border px-2 text-[11px]',
                      form.color === null
                        ? 'border-brand-purple text-ink'
                        : 'border-line text-ink-muted',
                    )}
                  >
                    Default
                  </button>
                  {MEETING_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      aria-pressed={form.color === c}
                      onClick={() => set('color', c)}
                      className={cn(
                        'h-6 w-6 rounded-full border-2',
                        form.color === c ? 'border-ink' : 'border-transparent',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {errors.form ? (
              <p role="alert" className="text-state-error text-sm">
                {errors.form}
              </p>
            ) : null}

            <DialogFooter className="items-center">
              {!editor.isEdit && editor.hasAttendees ? (
                <label className="text-ink mr-auto flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={editor.notifyNew}
                    onCheckedChange={(c) => editor.setNotifyNew(c === true)}
                  />
                  Notify attendees
                </label>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={editor.saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editor.saving}>
                {editor.isEdit ? 'Save' : 'Create meeting'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <MeetingScopeDialog
        open={scopeOpen}
        title="Save changes"
        description={
          editor.recurring ? 'This meeting repeats. Choose what the changes apply to.' : undefined
        }
        confirmLabel="Save"
        recurring={editor.recurring}
        hasAttendees={editor.hasAttendees}
        busy={editor.saving}
        onConfirm={confirmScope}
        onCancel={() => setScopeOpen(false)}
      />
    </>
  );
}

function LinkPickers({
  form,
  set,
  idPrefix,
}: {
  form: { leadId: string | null; clientId: string | null; projectId: string | null };
  set: (key: 'leadId' | 'clientId' | 'projectId', value: string | null) => void;
  idPrefix: string;
}) {
  const sales = useSalesAccess();
  const leads = useLeads({ pageSize: 500 });
  const clients = useClients({ pageSize: 500 });
  const projects = useProjects({ pageSize: 500 });
  const leadOptions = (sales.leads ? (leads.data?.items ?? []) : []).map((l) => ({
    value: l.id,
    label: l.name,
  }));
  const clientOptions = (sales.clients ? (clients.data?.items ?? []) : []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const projectOptions = (projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {sales.leads ? (
        <div>
          <Label htmlFor={`${idPrefix}-lead`}>Lead</Label>
          <Combobox
            id={`${idPrefix}-lead`}
            className="mt-1.5"
            options={leadOptions}
            value={form.leadId}
            onChange={(v) => set('leadId', v)}
            placeholder="None"
            searchPlaceholder="Search leads"
            clearable
          />
        </div>
      ) : null}
      {sales.clients ? (
        <div>
          <Label htmlFor={`${idPrefix}-client`}>Client</Label>
          <Combobox
            id={`${idPrefix}-client`}
            className="mt-1.5"
            options={clientOptions}
            value={form.clientId}
            onChange={(v) => set('clientId', v)}
            placeholder="None"
            searchPlaceholder="Search clients"
            clearable
          />
        </div>
      ) : null}
      <div>
        <Label htmlFor={`${idPrefix}-project`}>Project</Label>
        <Combobox
          id={`${idPrefix}-project`}
          className="mt-1.5"
          options={projectOptions}
          value={form.projectId}
          onChange={(v) => set('projectId', v)}
          placeholder="None"
          searchPlaceholder="Search projects"
          clearable
        />
      </div>
    </div>
  );
}
