'use client';

import { Download } from 'lucide-react';
import type { FormDetail, FormSubmissionSource } from '@botss/shared-types';

import { FormPagination } from '@/components/forms/list/form-pagination';
import { ResponsesList } from '@/components/forms/responses/responses-list';
import { ResponseSheet } from '@/components/forms/responses/response-sheet';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { QueryError } from '@/components/ui/query-error';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFormResponsesView } from '@/hooks/use-form-responses-view';

export function FormResponsesTab({ form }: { form: FormDetail }) {
  const view = useFormResponsesView(form.id);
  const { query } = view;
  const total = query.data?.pagination.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={view.source}
            onValueChange={(v) => view.setSource(v as FormSubmissionSource | 'ALL')}
          >
            <SelectTrigger className="w-40" aria-label="Filter by source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All sources</SelectItem>
              <SelectItem value="INTERNAL">In app</SelectItem>
              <SelectItem value="PUBLIC">Public link</SelectItem>
            </SelectContent>
          </Select>
          <DateRangePicker value={view.range} onChange={view.setRange} placeholder="Any date" />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={view.exportCsv}
          disabled={view.exporting || (!view.hasFilters && total === 0)}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />{' '}
          {view.exporting ? 'Exporting' : 'Export CSV'}
        </Button>
      </div>

      {query.isError ? (
        <QueryError message="Couldn't load responses." onRetry={() => void query.refetch()} />
      ) : (
        <>
          <ResponsesList
            table={view.table}
            isLoading={query.isLoading}
            hasFilters={view.hasFilters}
            onSelect={view.setSelectedId}
          />
          {query.data ? (
            <FormPagination
              page={query.data.pagination.page}
              totalPages={query.data.pagination.totalPages}
              total={query.data.pagination.total}
              onPage={view.setPage}
            />
          ) : null}
        </>
      )}

      <ResponseSheet
        formId={form.id}
        submission={view.selected?.submission ?? null}
        version={view.selected?.version}
        crmLabels={view.selected?.crmLabels ?? {}}
        onClose={() => view.setSelectedId(null)}
      />
    </div>
  );
}
