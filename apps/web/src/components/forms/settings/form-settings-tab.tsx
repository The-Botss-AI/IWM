'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { FormDetail } from '@botss/shared-types';

import { ToggleRow } from '@/components/forms/share/toggle-row';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useFormSettingsDraft } from '@/hooks/use-form-settings-draft';
import { useDeleteForm } from '@/hooks/use-forms';

export function FormSettingsTab({ form }: { form: FormDetail }) {
  const router = useRouter();
  const draft = useFormSettingsDraft(form);
  const remove = useDeleteForm();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    draft.save();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="form-title">Title</Label>
          <Input
            id="form-title"
            value={draft.title}
            maxLength={200}
            onChange={(e) => draft.setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="form-description">Description</Label>
          <Textarea
            id="form-description"
            rows={3}
            maxLength={2000}
            value={draft.description}
            onChange={(e) => draft.setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="form-confirmation">Confirmation message</Label>
          <Textarea
            id="form-confirmation"
            rows={3}
            maxLength={2000}
            value={draft.confirmationMessage}
            onChange={(e) => draft.setConfirmationMessage(e.target.value)}
            placeholder="Shown after someone submits"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="form-redirect">Redirect address</Label>
          <Input
            id="form-redirect"
            type="url"
            inputMode="url"
            value={draft.redirectUrl}
            onChange={(e) => draft.setRedirectUrl(e.target.value)}
            placeholder="https://example.com/thanks"
            aria-invalid={draft.redirectError ? true : undefined}
          />
          <p className="text-ink-muted text-xs">
            Optional. Sends people here after they submit instead of showing the message.
          </p>
          {draft.redirectError ? (
            <p className="text-state-error text-xs">{draft.redirectError}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="form-submit-label">Submit button label</Label>
          <Input
            id="form-submit-label"
            value={draft.submitLabel}
            maxLength={40}
            onChange={(e) => draft.setSubmitLabel(e.target.value)}
            placeholder="Submit"
          />
        </div>
        <ToggleRow
          label="Notify me on each response"
          description="You get an in-app notification and an email for every response."
          checked={draft.notifyOnSubmit}
          onChange={draft.setNotifyOnSubmit}
        />
        <Button type="submit" disabled={!draft.valid || draft.saving}>
          {draft.saving ? 'Saving' : 'Save'}
        </Button>
      </form>

      <section className="border-state-error/30 space-y-3 rounded-lg border p-4">
        <h2 className="text-state-error text-sm font-semibold">Danger zone</h2>
        <p className="text-ink-muted text-sm">
          Deleting a form removes it and all of its responses. This cannot be undone.
        </p>
        <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
          Delete form
        </Button>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this form?"
        description="The form, its public link and every response will be removed."
        confirmLabel="Delete form"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(form.id);
          router.push('/form-builder');
        }}
      />
    </div>
  );
}
