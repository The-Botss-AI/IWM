'use client';

import Link from 'next/link';
import { use } from 'react';
import { ForbiddenError, NotFoundError } from '@botss/api-client';
import type { FillableForm } from '@botss/shared-types';

import { FormNotFound } from '@/components/forms/form-not-found';
import { FormRenderer } from '@/components/forms/renderer/form-renderer';
import { PageLoader } from '@/components/ui/loader';
import { QueryError } from '@/components/ui/query-error';
import { useInternalFillHandlers } from '@/hooks/use-form-fill-handlers';
import { useSession } from '@/lib/auth-client';
import { useFillableForm } from '@/hooks/use-forms';

export default function FillFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useFillableForm(id);

  if (query.isLoading) return <PageLoader />;
  if (query.error instanceof NotFoundError || query.error instanceof ForbiddenError)
    return <FormNotFound />;
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <QueryError message="Couldn't load the form." onRetry={() => void query.refetch()} />
      </div>
    );
  }
  return <FillBody id={id} form={query.data} />;
}

function FillBody({ id, form }: { id: string; form: FillableForm }) {
  const { submit, uploader } = useInternalFillHandlers(id, form.version);
  // Progress is saved per signed-in person, so two people sharing a browser
  // never see each other's answers.
  const userId = useSession().data?.user?.id ?? null;
  const draftKey = userId ? `form:${id}:${userId}` : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:py-10">
      <Link href="/form-builder" className="text-ink-muted hover:text-ink text-sm">
        &larr; Forms
      </Link>
      {form.open ? (
        <div className="border-line bg-bg-surface rounded-2xl border p-4 sm:p-8">
          <FormRenderer
            title={form.title}
            description={form.description}
            definition={form.definition}
            version={form.version}
            draftKey={draftKey}
            mode="internal"
            submitLabel={form.submitLabel}
            submit={submit}
            uploader={uploader}
            allowAnother
          />
        </div>
      ) : (
        <div className="border-line bg-bg-surface rounded-2xl border px-6 py-12 text-center">
          <h1 className="text-ink text-lg font-semibold">{form.title}</h1>
          <p className="text-ink-muted mt-2 text-sm">
            This form is closed and no longer accepts responses.
          </p>
        </div>
      )}
    </div>
  );
}
