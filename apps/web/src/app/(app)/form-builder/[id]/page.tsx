'use client';

import { ExternalLink, Play } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { use, useCallback } from 'react';
import { ForbiddenError, NotFoundError } from '@botss/api-client';

import { FormBuilderTab } from '@/components/forms/builder/form-builder-tab';
import { FormNotFound } from '@/components/forms/form-not-found';
import { FormStatusBadge } from '@/components/forms/form-status-badge';
import { FormResponsesTab } from '@/components/forms/responses/form-responses-tab';
import { FormSettingsTab } from '@/components/forms/settings/form-settings-tab';
import { FormShareTab } from '@/components/forms/share/form-share-tab';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useForm } from '@/hooks/use-forms';
import { publicFormUrl } from '@/lib/forms/public-url';

const TABS = ['build', 'share', 'responses', 'settings'] as const;
type FormTab = (typeof TABS)[number];
const DEFAULT_TAB: FormTab = 'build';

function parseTab(value: string | null): FormTab {
  return (TABS as readonly string[]).includes(value ?? '') ? (value as FormTab) : DEFAULT_TAB;
}

export default function FormDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useForm(id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));

  const setTab = useCallback(
    (next: FormTab) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TAB) sp.delete('tab');
      else sp.set('tab', next);
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [searchParams, router],
  );

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (query.error instanceof NotFoundError || query.error instanceof ForbiddenError) {
    return <FormNotFound />;
  }
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <QueryError message="Couldn't load the form." onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const form = query.data;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/form-builder" className="text-ink-muted hover:text-ink text-sm">
        &larr; Forms
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="min-w-0 truncate text-xl font-semibold">{form.title}</h1>
          <FormStatusBadge form={form} />
        </div>
        <div className="flex flex-wrap gap-2">
          {form.canFill ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/form-builder/${form.id}/fill`}>
                <Play className="h-3.5 w-3.5" aria-hidden /> Fill in app
              </Link>
            </Button>
          ) : null}
          {form.publicEnabled && form.publicToken ? (
            <Button asChild variant="secondary" size="sm">
              <a href={publicFormUrl(form.publicToken)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open public page
              </a>
            </Button>
          ) : null}
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as FormTab)}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="share">Share</TabsTrigger>
          <TabsTrigger value="responses">
            Responses{form.submissionCount ? ` (${form.submissionCount})` : ''}
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        {/* Stays mounted so an in-flight autosave never races a fresh draft init. */}
        <TabsContent
          value="build"
          forceMount
          className="pt-4 data-[state=inactive]:hidden"
          hidden={tab !== 'build'}
        >
          <FormBuilderTab form={form} />
        </TabsContent>
        <TabsContent value="share" className="pt-4">
          <FormShareTab form={form} />
        </TabsContent>
        <TabsContent value="responses" className="pt-4">
          <FormResponsesTab form={form} />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <FormSettingsTab form={form} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
