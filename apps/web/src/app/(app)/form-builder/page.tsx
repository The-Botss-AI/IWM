'use client';

import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import type { FormListScope } from '@botss/shared-types';

import { FormList } from '@/components/forms/list/form-list';
import { FormPagination } from '@/components/forms/list/form-pagination';
import { NewFormDialog } from '@/components/forms/list/new-form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-error';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFormListView } from '@/hooks/use-form-list-view';

export default function FormsPage() {
  const view = useFormListView();
  const [creating, setCreating] = useState(false);
  const { list } = view;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Forms</h1>
          <p className="text-ink-muted text-sm">Build forms, share them and collect responses.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden /> New form
        </Button>
      </header>

      <Tabs value={view.scope} onValueChange={(v) => view.setScope(v as FormListScope)}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="mine">My forms</TabsTrigger>
          <TabsTrigger value="shared">Shared with me</TabsTrigger>
          {view.canSeeAll ? <TabsTrigger value="all">All forms</TabsTrigger> : null}
        </TabsList>
      </Tabs>

      <div className="relative max-w-sm">
        <Search
          className="text-ink-disabled pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={view.search}
          onChange={(e) => view.setSearch(e.target.value)}
          placeholder="Search forms"
          aria-label="Search forms"
          className="pl-9"
        />
      </div>

      {list.isError ? (
        <QueryError message="Couldn't load forms." onRetry={() => void list.refetch()} />
      ) : (
        <>
          <FormList
            forms={list.data?.items ?? []}
            scope={view.scope}
            isLoading={list.isLoading}
            hasFilters={view.hasFilters}
            onCreate={() => setCreating(true)}
          />
          {list.data ? (
            <FormPagination
              page={list.data.pagination.page}
              totalPages={list.data.pagination.totalPages}
              total={list.data.pagination.total}
              onPage={view.setPage}
            />
          ) : null}
        </>
      )}

      <NewFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
