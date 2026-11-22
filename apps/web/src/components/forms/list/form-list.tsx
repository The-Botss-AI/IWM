'use client';

import { Globe } from 'lucide-react';
import Link from 'next/link';
import type { FormListScope, FormSummary } from '@botss/shared-types';

import { FormStatusBadge } from '@/components/forms/form-status-badge';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsSmall } from '@/hooks/use-media-query';
import { relativeTime } from '@/lib/time';

/** Shared and fill-only rows open the fill page; managed forms open the builder. */
function hrefFor(form: FormSummary, scope: FormListScope): string {
  if (scope === 'shared' || !form.canManage) return `/form-builder/${form.id}/fill`;
  return `/form-builder/${form.id}`;
}

interface Props {
  forms: FormSummary[];
  scope: FormListScope;
  isLoading: boolean;
  hasFilters: boolean;
  onCreate: () => void;
}

const EMPTY_COPY: Record<FormListScope, { title: string; hint: string }> = {
  mine: {
    title: 'No forms yet',
    hint: 'Build a form, publish it and share a link to start collecting responses.',
  },
  shared: {
    title: 'Nothing shared with you',
    hint: 'Forms teammates share with you will show up here.',
  },
  all: {
    title: 'No forms in this workspace',
    hint: 'Forms anyone in the workspace creates will show up here.',
  },
};

export function FormList({ forms, scope, isLoading, hasFilters, onCreate }: Props) {
  const isSmall = useIsSmall();

  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }

  if (forms.length === 0) {
    const copy = hasFilters
      ? { title: 'No forms match this search', hint: 'Try a different word or clear the search.' }
      : EMPTY_COPY[scope];
    return (
      <div className="border-line rounded-lg border border-dashed bg-white p-10 text-center">
        <p className="text-ink text-sm font-medium">{copy.title}</p>
        <p className="text-ink-muted mt-1 text-sm">{copy.hint}</p>
        {scope === 'mine' && !hasFilters ? (
          <Button className="mt-4" onClick={onCreate}>
            New form
          </Button>
        ) : null}
      </div>
    );
  }

  if (isSmall) {
    return (
      <ul className="divide-line border-line divide-y rounded-lg border bg-white">
        {forms.map((f) => (
          <li key={f.id}>
            <Link
              href={hrefFor(f, scope)}
              className="hover:bg-bg-subtle focus-visible:bg-bg-subtle flex flex-col gap-2 p-3 focus-visible:outline-none"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-ink min-w-0 truncate text-sm font-medium">{f.title}</span>
                <FormStatusBadge form={f} />
              </div>
              <div className="text-ink-muted flex flex-wrap items-center gap-2 text-xs">
                {f.submissionCount !== null ? <span>{f.submissionCount} responses</span> : null}
                {f.publicEnabled ? <PublicBadge /> : null}
                <span>{relativeTime(f.updatedAt)}</span>
              </div>
              <span className="text-ink-muted truncate text-xs">
                {f.createdBy.name || f.createdBy.email}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="border-line overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-bg-subtle text-ink-muted text-left text-xs font-medium uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Responses</th>
            <th className="px-3 py-2">Public link</th>
            <th className="px-3 py-2">Owner</th>
            <th className="px-3 py-2">Updated</th>
          </tr>
        </thead>
        <tbody>
          {forms.map((f) => (
            <tr key={f.id} className="border-line hover:bg-bg-subtle border-t">
              <td className="max-w-[320px] px-3 py-2 align-middle">
                <Link
                  href={hrefFor(f, scope)}
                  className="text-ink hover:text-brand-700 focus-visible:text-brand-700 block truncate font-medium focus-visible:outline-none"
                >
                  {f.title}
                </Link>
              </td>
              <td className="px-3 py-2 align-middle">
                <FormStatusBadge form={f} />
              </td>
              <td className="text-ink px-3 py-2 align-middle">{f.submissionCount ?? '-'}</td>
              <td className="px-3 py-2 align-middle">
                {f.publicEnabled ? <PublicBadge /> : <span className="text-ink-disabled">Off</span>}
              </td>
              <td className="px-3 py-2 align-middle">
                <div className="flex min-w-0 items-center gap-2">
                  <UserAvatar
                    size="sm"
                    name={f.createdBy.name || f.createdBy.email}
                    image={f.createdBy.image}
                  />
                  <span className="text-ink truncate">{f.createdBy.name || f.createdBy.email}</span>
                </div>
              </td>
              <td className="text-ink-muted px-3 py-2 align-middle text-xs">
                {relativeTime(f.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PublicBadge() {
  return (
    <Badge tone="outline">
      <Globe className="h-3 w-3" aria-hidden /> Public
    </Badge>
  );
}
