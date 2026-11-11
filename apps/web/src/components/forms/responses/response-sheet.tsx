'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { FormSubmission, FormVersion } from '@botss/shared-types';

import { AnswerView } from '@/components/forms/responses/answer-view';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useDeleteSubmission } from '@/hooks/use-forms';
import { inputFields } from '@/lib/forms/responses';
import { absoluteTime } from '@/lib/time';

interface Props {
  formId: string;
  submission: FormSubmission | null;
  version: FormVersion | undefined;
  crmLabels: Record<string, string>;
  onClose: () => void;
}

/** Every answer of one response, laid out by the version the person filled. */
export function ResponseSheet({ formId, submission, version, crmLabels, onClose }: Props) {
  const remove = useDeleteSubmission(formId);
  const [confirming, setConfirming] = useState(false);
  const fields = version ? inputFields(version.definition) : [];

  return (
    <>
      <Sheet open={!!submission} onOpenChange={(open) => (open ? undefined : onClose())}>
        <SheetContent>
          {submission ? (
            <>
              <SheetHeader>
                <SheetTitle className="text-base font-semibold">Response</SheetTitle>
                <SheetDescription className="text-ink-muted text-xs">
                  {absoluteTime(submission.createdAt)} by{' '}
                  {submission.submittedBy
                    ? submission.submittedBy.name || submission.submittedBy.email
                    : 'Public link'}
                </SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                {fields.length === 0 ? (
                  <p className="text-ink-muted text-sm">
                    The questions for this response are no longer available.
                  </p>
                ) : (
                  fields.map((f) => (
                    <div key={f.id} className="space-y-1">
                      <p className="text-ink-muted text-xs font-medium">{f.label}</p>
                      <div className="text-ink text-sm">
                        <AnswerView
                          field={f}
                          value={submission.answers[f.id]}
                          ctx={{ formId, submission, crmLabels }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </SheetBody>
              <SheetFooter>
                <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete response
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this response?"
        description="The answers and any uploaded files are removed. This cannot be undone."
        confirmLabel="Delete response"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={async () => {
          if (!submission) return;
          await remove.mutateAsync(submission.id);
          setConfirming(false);
          onClose();
        }}
      />
    </>
  );
}
