'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { NotFoundError } from '@botss/api-client';
import type { FillableForm } from '@botss/shared-types';

import { FormRenderer } from '@/components/forms/renderer/form-renderer';
import { PageLoader } from '@/components/ui/loader';
import { QueryError } from '@/components/ui/query-error';
import { useFormUrlParams } from '@/hooks/use-form-url-params';
import { usePublicFillHandlers } from '@/hooks/use-form-fill-handlers';
import { usePublicForm } from '@/hooks/use-forms';
import { env } from '@/lib/env';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      {children}
      <p className="text-ink-disabled mt-6 text-center text-xs">Powered by The Botss</p>
    </div>
  );
}

export function PublicFormView({ token }: { token: string }) {
  const query = usePublicForm(token);

  if (query.isLoading) return <PageLoader />;
  if (query.error instanceof NotFoundError) {
    return (
      <Frame>
        <Message
          title="Form not found"
          body="This link doesn't work. It may have been turned off or replaced."
        />
      </Frame>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Frame>
        <QueryError message="Couldn't load the form." onRetry={() => void query.refetch()} />
      </Frame>
    );
  }
  return (
    <Frame>
      <PublicFormBody token={token} form={query.data} />
    </Frame>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-line bg-bg-surface rounded-2xl border px-6 py-12 text-center">
      <h1 className="text-ink text-lg font-semibold">{title}</h1>
      <p className="text-ink-muted mt-2 text-sm">{body}</p>
    </div>
  );
}

function PublicFormBody({ token, form }: { token: string; form: FillableForm }) {
  const { submit, uploader } = usePublicFillHandlers(token, form.version);
  const searchParams = useSearchParams();
  const params = useFormUrlParams(searchParams);
  const siteKey = useMemo(() => env.turnstileSiteKey || null, []);

  if (!form.open) {
    return (
      <Message title={form.title} body="This form is closed and no longer accepts responses." />
    );
  }
  return (
    <div className="border-line bg-bg-surface rounded-2xl border p-4 sm:p-8">
      <FormRenderer
        title={form.title}
        description={form.description}
        definition={form.definition}
        version={form.version}
        mode="public"
        submitLabel={form.submitLabel}
        params={params}
        submit={submit}
        uploader={uploader}
        turnstileSiteKey={siteKey}
        draftKey={`public:${token}`}
        allowAnother
      />
    </div>
  );
}
