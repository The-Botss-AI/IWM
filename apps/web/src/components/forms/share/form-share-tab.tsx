'use client';

import { Copy, ExternalLink, Globe, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import type { FormDetail, FormInternalAccess } from '@botss/shared-types';

import { ToggleRow } from '@/components/forms/share/toggle-row';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader } from '@/components/ui/loader';
import { QueryError } from '@/components/ui/query-error';
import { WorkspaceMembersCombobox } from '@/components/workspace/workspace-members-combobox';
import { useCopyLink } from '@/hooks/use-copy-link';
import {
  useAddFormAccess,
  useFormAccess,
  useRemoveFormAccess,
  useRotateFormLink,
  useSetFormOpen,
  useSetFormPublicLink,
  useUpdateForm,
} from '@/hooks/use-forms';
import { acceptingDraft } from '@/lib/forms/accepting';
import { toDateTimeLocal } from '@/lib/forms/datetime';
import { publicFormUrl } from '@/lib/forms/public-url';

const ACCESS_OPTIONS: ReadonlyArray<{ value: FormInternalAccess; label: string; hint: string }> = [
  { value: 'NONE', label: 'Off', hint: 'Only you and workspace admins can open it.' },
  {
    value: 'WORKSPACE',
    label: 'Everyone in this workspace',
    hint: 'Any member can fill it in the app.',
  },
  { value: 'SELECTED', label: 'Selected people', hint: 'Only the people you add can fill it.' },
];

export function FormShareTab({ form }: { form: FormDetail }) {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <InsideCrmSection form={form} />
      <PublicLinkSection form={form} />
      <AcceptingSection form={form} />
    </div>
  );
}

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="text-ink-muted mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
      {icon} {children}
    </h2>
  );
}

function InsideCrmSection({ form }: { form: FormDetail }) {
  const update = useUpdateForm(form.id);
  const selected = form.internalAccess === 'SELECTED';
  const access = useFormAccess(form.id, selected);
  const add = useAddFormAccess(form.id);
  const remove = useRemoveFormAccess(form.id);
  const entries = access.data ?? [];

  return (
    <section>
      <SectionTitle icon={<Users className="h-3.5 w-3.5" aria-hidden />}>
        Inside the CRM
      </SectionTitle>
      <div role="radiogroup" aria-label="Who can fill this form in the app" className="space-y-2">
        {ACCESS_OPTIONS.map((o) => (
          <label
            key={o.value}
            className="border-line flex cursor-pointer items-start gap-3 rounded-md border bg-white p-3"
          >
            <input
              type="radio"
              name="form-internal-access"
              checked={form.internalAccess === o.value}
              disabled={update.isPending}
              onChange={() => update.mutate({ internalAccess: o.value })}
              className="accent-brand-600 mt-1 h-4 w-4"
            />
            <span className="min-w-0">
              <span className="text-ink block text-sm font-medium">{o.label}</span>
              <span className="text-ink-muted block text-xs">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {form.status !== 'PUBLISHED' ? (
        <p className="text-ink-muted mt-2 text-xs">
          The form must be published before anyone can fill it. Publish it from the Build tab.
        </p>
      ) : null}

      {selected ? (
        <div className="mt-4 space-y-3">
          <WorkspaceMembersCombobox
            value={null}
            onChange={(userId) => {
              if (userId) add.mutate({ userIds: [userId] });
            }}
            excludeUserIds={[...entries.map((e) => e.user.id), form.createdBy.id]}
            placeholder="Add a person"
            clearable={false}
            disabled={add.isPending}
          />
          {access.isLoading ? (
            <Loader size="sm" />
          ) : access.isError ? (
            <QueryError
              compact
              message="Couldn't load the people list."
              onRetry={() => void access.refetch()}
            />
          ) : entries.length === 0 ? (
            <p className="text-ink-muted text-sm">No one added yet.</p>
          ) : (
            <ul className="divide-line border-line divide-y rounded-md border bg-white">
              {entries.map((e) => (
                <li key={e.user.id} className="flex items-center gap-3 p-2.5">
                  <UserAvatar size="sm" name={e.user.name || e.user.email} image={e.user.image} />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-sm">{e.user.name || e.user.email}</p>
                    <p className="text-ink-muted truncate text-xs">{e.user.email}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${e.user.name || e.user.email}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(e.user.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PublicLinkSection({ form }: { form: FormDetail }) {
  const setLink = useSetFormPublicLink(form.id);
  const rotate = useRotateFormLink(form.id);
  const copy = useCopyLink();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const url = form.publicEnabled && form.publicToken ? publicFormUrl(form.publicToken) : '';

  return (
    <section className="border-line border-t pt-6">
      <SectionTitle icon={<Globe className="h-3.5 w-3.5" aria-hidden />}>Public link</SectionTitle>
      <div className="space-y-3">
        <ToggleRow
          label="Anyone with the link can fill it"
          description={
            form.publicEnabled
              ? 'People do not need an account. The form must be published and open.'
              : 'Turn on to get a link you can share outside the workspace.'
          }
          checked={form.publicEnabled}
          disabled={setLink.isPending}
          onChange={(next) => setLink.mutate(next)}
        />
        {url ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="form-public-url">Link</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="form-public-url"
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="secondary" onClick={() => void copy(url)}>
                  <Copy className="h-4 w-4" aria-hidden /> Copy
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open link
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
                Make a new link
              </Button>
            </div>
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Make a new link?"
        description="The current link stops working right away. Anyone who has it will need the new one."
        confirmLabel="Make a new link"
        variant="destructive"
        pending={rotate.isPending}
        onConfirm={async () => {
          await rotate.mutateAsync(undefined);
          setConfirmRotate(false);
        }}
      />
    </section>
  );
}

function AcceptingSection({ form }: { form: FormDetail }) {
  const setOpen = useSetFormOpen(form.id);
  const update = useUpdateForm(form.id);
  const [closesAt, setClosesAt] = useState(toDateTimeLocal(form.closesAt));
  const [limit, setLimit] = useState(form.responseLimit ? String(form.responseLimit) : '');
  const published = form.status !== 'DRAFT';

  const draft = acceptingDraft(closesAt, limit, form);
  const { limitInvalid, dirty } = draft;

  const save = () =>
    update.mutate({ closesAt: draft.closesAt, responseLimit: draft.responseLimit });

  return (
    <section className="border-line border-t pt-6">
      <SectionTitle>Accepting responses</SectionTitle>
      <div className="space-y-4">
        <ToggleRow
          label="Accepting responses"
          description={
            published
              ? form.status === 'PUBLISHED'
                ? 'Turn off to stop new responses without deleting anything.'
                : 'The form is closed. Turn on to open it again.'
              : 'Publish the form first.'
          }
          checked={form.status === 'PUBLISHED'}
          disabled={!published || setOpen.isPending}
          onChange={(next) => setOpen.mutate(next)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="form-closes-at">Close date</Label>
            <div className="flex gap-2">
              <Input
                id="form-closes-at"
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
              />
              {closesAt ? (
                <Button variant="ghost" size="sm" onClick={() => setClosesAt('')}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-limit">Response limit</Label>
            <div className="flex gap-2">
              <Input
                id="form-limit"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="No limit"
              />
              {limit ? (
                <Button variant="ghost" size="sm" onClick={() => setLimit('')}>
                  Clear
                </Button>
              ) : null}
            </div>
            {limitInvalid ? (
              <p className="text-state-error text-xs">Enter a whole number of 1 or more.</p>
            ) : null}
          </div>
        </div>
        <Button onClick={save} disabled={!dirty || limitInvalid || update.isPending}>
          {update.isPending ? 'Saving' : 'Save'}
        </Button>
      </div>
    </section>
  );
}
